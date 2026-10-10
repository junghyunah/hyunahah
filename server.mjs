import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createSupabaseStore } from './supabase-store.mjs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const HOURS = [0,2,1,1,1,1,1,1,1,3,3,3,2,2,1,1,3,1];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const stamp = () => new Date().toISOString();
export const validDate = value => { if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false; const date=new Date(value); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value; };
const safeText = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[<>"'`]/.test(value);
function checkCourses(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !Number.isInteger(id) || !HOURS[id]) || ids.reduce((sum,id) => sum + HOURS[id],0) !== 3) fail(400,'교육시간 합계는 정확히 3시간이어야 합니다.');
}
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
function passwordMatches(password, encoded) {
  const [salt, hash] = encoded.split(':');
  return timingSafeEqual(Buffer.from(passwordHash(password,salt).split(':')[1],'hex'), Buffer.from(hash,'hex'));
}
function assignmentsFor(state, part) {
  const own = state.assignments.filter(a => a.targetType === 'individual' && a.participantId === part.id);
  return [...own,...state.assignments.filter(a => a.targetType === 'dept' && a.targetDept === part.dept && !(a.excludedParticipantIds||[]).includes(part.id) && !own.some(b => a.assignDate === b.assignDate))].sort((a,b) => a.assignDate.localeCompare(b.assignDate));
}
function effectiveAssignment(state, part, date) {
  return assignmentsFor(state,part).find(a => a.assignDate === date);
}
function isComplete(sub, assign) {
  return !!sub && assign.courseIds.every(id => sub.completedCourseIds.includes(id) && sub.signatures[id]);
}

export async function createApplication({ store = createSupabaseStore(), password = process.env.ADMIN_PASSWORD, secureCookies = process.env.COOKIE_SECURE === 'true' } = {}) {
  let initial = await store.load();
  if (!initial.passwordHash) {
    if (!password || password.length < 12) throw new Error('첫 실행에는 ADMIN_PASSWORD를 12자 이상으로 설정하세요.');
    await store.save({...initial,passwordHash:passwordHash(password)});
  }
  const sessions = new Map();
  const attempts = new Map();
  function loginLimit(req) {
    const key = req.socket.remoteAddress;
    const entry = attempts.get(key);
    if (entry && entry.until > Date.now() && entry.count >= 20) fail(429,'잠시 후 다시 시도해주세요.');
    if (!entry || entry.until <= Date.now()) attempts.set(key,{count:1,until:Date.now()+600000});
    else entry.count++;
  }
  function session(req,role) {
    const token = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    const entry = sessions.get(token);
    if (!entry || entry.until < Date.now() || (role && entry.role !== role)) fail(401,'다시 로그인해주세요.');
    return entry;
  }
  function newSession(res,role,id) {
    const token=randomBytes(32).toString('hex');
    sessions.set(token,{role,id,until:Date.now()+8*3600000});
    res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookies?'; Secure':''}`);
  }
  const publicState = s => ({settings:{orgName:s.settings.orgName,depts:[]},participants:[],assignments:[],submissions:[],auditLogs:[],customPdfBase64:null});
  const ownState = (s,id) => {
    const part=s.participants.find(p=>p.id===id); if(!part) fail(401,'등록 정보를 다시 확인해주세요.');
    return {...publicState(s),participants:[part],assignments:assignmentsFor(s,part),submissions:s.submissions.filter(sub=>sub.participantId===id)};
  };
  function validateState(s) {
    if(!s || !s.settings || !safeText(s.settings.orgName) || !Array.isArray(s.settings.depts) || !s.settings.depts.every(safeText)) fail(400,'기관 설정을 확인해주세요.');
    for(const key of ['participants','assignments','submissions']) if(!Array.isArray(s[key]) || s[key].length>10000) fail(400,'데이터 형식을 확인해주세요.');
    const seen=new Set(); const identities=new Set();
    for(const p of s.participants) {
      if(!safeText(p.id)||seen.has(p.id)||!safeText(p.name)||!safeText(p.dept)||(p.phone && !safeText(p.phone))|| !/^\d{8}$/.test(p.birthDate)|| !validDate(`${p.birthDate.slice(0,4)}-${p.birthDate.slice(4,6)}-${p.birthDate.slice(6)}`)) fail(400,'참여자 이름, 생년월일, 사업단 또는 중복 ID를 확인해주세요.');
      const identity=`${p.name}/${p.birthDate}`;
      if(identities.has(identity)) fail(400,'이름과 생년월일이 같은 참여자가 중복됩니다.');
      identities.add(identity); seen.add(p.id);
    }
    const targets=new Set(); const assignmentIds=new Set();
    for(const a of s.assignments) {
      checkCourses(a.courseIds);
      if(!safeText(a.id)||assignmentIds.has(a.id)||!validDate(a.assignDate)||!a.assignDate.startsWith('2026-')||a.totalHours!==3) fail(400,'교육 배정 정보를 확인해주세요.');
      assignmentIds.add(a.id);
      if(a.targetType==='individual'?!seen.has(a.participantId):a.targetType!=='dept'||!s.settings.depts.includes(a.targetDept)) fail(400,'배정 대상을 확인해주세요.');
      const key=`${a.targetType}/${a.participantId||a.targetDept}/${a.assignDate}`;
      if(targets.has(key)) fail(400,'같은 대상과 날짜의 교육 배정이 중복됩니다.'); targets.add(key);
    }
  }
  const fontBytes=readFileSync(join(ROOT,'assets/NotoSansKR.ttf'));
  const templateBytes=readFileSync(join(ROOT,'이수확인증_양식.pdf'));
  async function makePdf(s,part,assign,sub) {
    const pdf=await PDFDocument.load(templateBytes); pdf.registerFontkit(fontkit);
    const font=await pdf.embedFont(fontBytes,{subset:true}); const page=pdf.getPages()[0];
    // Positions are measured from the official template, without replacing its text.
    for(const [text,x,y] of [[s.settings.orgName,400,684],[part.dept,400,663],[`${part.birthDate.slice(0,4)}.${part.birthDate.slice(4,6)}.${part.birthDate.slice(6)}`,400,642],[part.name,400,621]]) {
      const size=Math.min(12,160/font.widthOfTextAtSize(text,1)); page.drawText(text,{x,y,size,font});
    }
    const tops=[0,327.572,345.672,363.772,381.753,399.853,426.224,460.986,504.139,544.295,572.944,596.198,614.299,632.279,650.379,668.479,686.460,704.560];
    for(const id of assign.courseIds) {
      const y=841-tops[id]-12;
      // The printed year and dots remain untouched; fill only month/day gaps.
      page.drawText(assign.assignDate.slice(5,7),{x:334,y,size:10,font});
      page.drawText(assign.assignDate.slice(8,10),{x:357,y,size:10,font});
      const sig=await pdf.embedPng(sub.signatures[id]); const scale=Math.min(60/sig.width,16/sig.height);
      page.drawImage(sig,{x:390,y:y-2,width:sig.width*scale,height:sig.height*scale});
    }
    return await pdf.save();
  }
  let writeQueue=Promise.resolve();
  function serialized(action) { const next=writeQueue.then(action); writeQueue=next.catch(()=>{}); return next; }
  async function body(req) {
    let size=0; const chunks=[]; for await(const chunk of req) {size+=chunk.length;if(size>15*1024*1024)fail(413,'파일이 너무 큽니다.');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail(400,'요청 형식이 올바르지 않습니다.');}
  }
  function send(res,data,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Frame-Options','DENY');
    try {
      const url=new URL(req.url,'http://localhost'); const path=url.pathname;
      let snapshot;
      const state=()=>snapshot.state; const revision=()=>snapshot.revision;
      const refresh=async()=>{snapshot=await store.load();};
      const commit=async(s,documents=[],hash=null)=>store.save({state:s,revision:revision(),documents,passwordHash:hash});
      if(path.startsWith('/api/') && !['/api/health','/api/logout'].includes(path))await refresh();
      if(req.method!=='GET' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)fail(403,'외부 요청은 허용하지 않습니다.');
      if(path==='/api/health')return send(res,{ok:true});
      if(path==='/api/public'&&req.method==='GET')return send(res,{state:publicState(state())});
      if(path==='/api/login'&&req.method==='POST') {
        loginLimit(req); const input=await body(req);
        if(input.role==='admin') {if(typeof input.password!=='string'||input.password.length>256||!passwordMatches(input.password,snapshot.passwordHash))fail(401,'비밀번호를 다시 확인해주세요.');newSession(res,'admin');return send(res,{state:state(),revision:revision()});}
        const found=state().participants.filter(p=>p.name===input.name&&p.birthDate===input.birthDate);
        if(found.length!==1)fail(401,'이름과 생년월일을 다시 확인해주세요.');
        newSession(res,'participant',found[0].id);return send(res,{state:ownState(state(),found[0].id)});
      }
      if(path==='/api/logout'&&req.method==='POST') {const token=/(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];sessions.delete(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,{ok:true});}
      if(path==='/api/state'&&req.method==='GET'){const who=session(req);return send(res,{state:who.role==='admin'?state():ownState(state(),who.id),revision:who.role==='admin'?revision():undefined});}
      if(path==='/api/state'&&req.method==='PUT') {
        session(req,'admin'); const input=await body(req);
        return await serialized(async()=>{await refresh();
          if(input.revision!==revision())fail(409,'다른 화면에서 데이터가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
          const old=state(); const s=input.state; validateState(s);
          // Submissions and audit history may only be changed through their dedicated endpoints.
          if(!isDeepStrictEqual(s.submissions,old.submissions))fail(400,'서명 기록은 교육 수정 기능으로 변경해주세요.');
          for(const sub of old.submissions){const part=s.participants.find(p=>p.id===sub.participantId);const a=part&&effectiveAssignment(s,part,sub.assignDate);const previous=effectiveAssignment(old,old.participants.find(p=>p.id===sub.participantId),sub.assignDate);if(!a||JSON.stringify(a.courseIds)!==JSON.stringify(previous.courseIds))fail(400,'서명이 있는 배정은 교육 수정 기능을 사용해주세요.');}
          const newPassword=s.settings.adminPassword; delete s.settings.adminPassword;
          if(newPassword&&newPassword.length<12)fail(400,'비밀번호는 12자 이상 입력해주세요.');
          s.customPdfBase64=null; s.auditLogs=[...old.auditLogs,{id:randomBytes(8).toString('hex'),type:'admin-save',targetId:'settings',reason:'담당자 저장',timestamp:stamp(),manager:'담당자'}];
          const rev=await commit(s,[],newPassword?passwordHash(newPassword):null);return send(res,{state:s,revision:rev});
        });
      }
      if(path==='/api/submission'&&req.method==='POST'){
        const who=session(req,'participant'); const input=await body(req);
        return await serialized(async()=>{await refresh();
          const s=state(); const part=s.participants.find(p=>p.id===who.id);const a=part&&effectiveAssignment(s,part,input.assignDate);if(!a)fail(400,'교육 배정을 찾을 수 없습니다.');
          let sub=s.submissions.find(x=>x.participantId===who.id&&x.assignDate===a.assignDate);
          if(isComplete(sub,a))return send(res,{state:ownState(s,who.id),complete:true});
          const ids=input.completedCourseIds;
          if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!a.courseIds.includes(id)))fail(400,'교육 과목을 확인해주세요.');
          const sigs=input.signatures||{};
          for(const id of ids){const value=sigs[id];if(typeof value!=='string'||value.length>500000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))fail(400,'서명을 다시 입력해주세요.');const buffer=Buffer.from(value.split(',')[1],'base64');if(buffer.length<32||buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||buffer.readUInt32BE(16)>2000||buffer.readUInt32BE(20)>2000)fail(400,'서명 이미지가 올바르지 않습니다.');
            let image;try{image=PNG.sync.read(buffer);}catch{fail(400,'서명 이미지가 올바르지 않습니다.');}
            let ink=0;for(let n=0;n<image.data.length;n+=4)if(image.data[n+3]>30&&Math.min(image.data[n],image.data[n+1],image.data[n+2])<220)ink++;
            if(ink<30)fail(400,'빈 서명은 제출할 수 없습니다. 이름을 다시 써주세요.');
          }
          if(!sub){sub={id:randomBytes(12).toString('hex'),participantId:who.id,assignmentId:a.id,assignDate:a.assignDate,completedCourseIds:[],signatures:{},reviewed:false,reviewedAt:null};s.submissions.push(sub);}
          for(const id of ids){if(!sub.completedCourseIds.includes(id))sub.completedCourseIds.push(id);sub.signatures[id]=sigs[id];}
          const complete=isComplete(sub,a);sub.savedAt=stamp();const docs=[];
          if(complete){sub.submittedAt=new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});docs.push({participant:who.id,date:a.assignDate,pdf:await makePdf(s,part,a,sub)});}
          await commit(s,docs);return send(res,{state:ownState(s,who.id),complete});
        });
      }
      if(path==='/api/review'&&req.method==='POST'){
        session(req,'admin');const input=await body(req);return await serialized(async()=>{await refresh();const s=state();const sub=s.submissions.find(x=>x.id===input.id);if(!sub)fail(404,'기록을 찾을 수 없습니다.');sub.reviewed=!sub.reviewed;sub.reviewedAt=sub.reviewed?stamp():null;const rev=await commit(s);return send(res,{state:s,revision:rev});});
      }
      if(path==='/api/correction'&&req.method==='POST') {
        session(req,'admin');const input=await body(req);return await serialized(async()=>{await refresh();
          const s=state();const part=s.participants.find(p=>p.id===input.participantId);const a=part&&effectiveAssignment(s,part,input.oldDate);const sub=s.submissions.find(x=>x.participantId===input.participantId&&x.assignDate===input.oldDate);
          if(!a||!sub)fail(404,'수정할 제출 기록이 없습니다.');checkCourses(input.courseIds);if(!validDate(input.date)||!input.date.startsWith('2026-')||!safeText(input.reason))fail(400,'날짜와 수정 사유를 확인해주세요.');
          if(input.date!==input.oldDate&&(effectiveAssignment(s,part,input.date)||s.submissions.some(x=>x.participantId===part.id&&x.assignDate===input.date)))fail(409,'변경 날짜에 이미 교육이 있습니다.');
          const mapped={};const used=new Set();for(const id of input.courseIds){const source=input.mapping?.[id];if(!sub.signatures[source]||used.has(Number(source)))fail(400,'과목마다 서로 다른 기존 서명을 연결해주세요.');used.add(Number(source));mapped[id]=sub.signatures[source];}
          const before=structuredClone({assignment:a,submission:sub});
          // A submitted group assignment is corrected only for the selected participant.
          let replacement=s.assignments.find(x=>x.targetType==='individual'&&x.participantId===part.id&&x.assignDate===input.oldDate);
          if(!replacement){replacement={...a,id:randomBytes(12).toString('hex'),targetType:'individual',participantId:part.id,targetDept:null};s.assignments.push(replacement);}
          if(input.date!==input.oldDate && a.targetType==='dept') a.excludedParticipantIds=[...(a.excludedParticipantIds||[]),part.id];
          Object.assign(replacement,{assignDate:input.date,courseIds:input.courseIds,totalHours:3});Object.assign(sub,{assignDate:input.date,assignmentId:replacement.id,completedCourseIds:input.courseIds,signatures:mapped,reviewed:false,reviewedAt:null});
          s.auditLogs.push({id:randomBytes(12).toString('hex'),type:'correction',targetId:sub.id,before,after:structuredClone({assignment:replacement,submission:sub}),reason:input.reason,manager:'담당자',timestamp:stamp()});
          const rev=await commit(s,[{participant:part.id,date:input.date,pdf:await makePdf(s,part,replacement,sub)}]);return send(res,{state:s,revision:rev});
        });
      }
      if(path==='/api/pdf'&&req.method==='GET'){
        session(req,'admin');const pdf=await store.document(url.searchParams.get('participant'),url.searchParams.get('date'));if(!pdf)fail(404,'완료된 확인증이 없습니다.');res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="certificate.pdf"'});return res.end(pdf);
      }
      if(path.startsWith('/api/'))fail(404,'요청을 찾을 수 없습니다.');
      const files={'/':'index.html','/index.html':'index.html','/client.js':'client.js','/styles.css':'styles.css','/pdf_template_b64.js':'pdf_template_b64.js','/vendor/lucide.js':'node_modules/lucide/dist/umd/lucide.js','/vendor/xlsx.js':'node_modules/xlsx/dist/xlsx.full.min.js','/vendor/pdf-lib.js':'node_modules/pdf-lib/dist/pdf-lib.min.js','/vendor/jszip.js':'node_modules/jszip/dist/jszip.min.js'};
      if(req.method!=='GET'||!files[path])fail(404,'페이지를 찾을 수 없습니다.');
      const ext=path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'Content-Type':`${ext}; charset=utf-8`});res.end(readFileSync(join(ROOT,files[path])));
    }catch(e){if(!res.headersSent)send(res,{error:e.status?e.message:'처리 중 오류가 발생했습니다. 다시 시도하거나 담당자에게 문의해주세요.'},e.status||500);else res.end();if(!e.status)console.error('Request failed:',e.message);}
  });
  return {server,close:()=>server.close()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createApplication();app.server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('교육 이수 확인 서버가 시작되었습니다.'));
}

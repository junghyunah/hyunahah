// Browser UI adapter. Supabase credentials never enter the browser.
let serverRevision = 0;
let lastServerState = null;
let autosaveTimer;
let saveQueue = Promise.resolve();
let submitting = false;
async function requestApi(path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(`/api/${path}`, {method,credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '저장하지 못했습니다. 다시 시도해주세요.');
  return result;
}
function applyServerResult(result) {
  AppState=result.state;
  lastServerState=structuredClone(AppState);
  if(result.revision!==undefined)serverRevision=result.revision;
}
loadStateFromStorage = async function() {
  try { applyServerResult(await requestApi('public')); }
  catch(error) { showToast('서버 연결을 확인해주세요. '+error.message,'alert'); }
};
saveStateToStorage = async function() {
  if(!isAdminLoggedIn)throw new Error('담당자 로그인이 필요합니다.');
  try {
    const result=await requestApi('state',{state:AppState,revision:serverRevision},'PUT');
    applyServerResult(result);
  } catch(error) {
    try {applyServerResult(await requestApi('state'));}
    catch {if(lastServerState)AppState=structuredClone(lastServerState);}
    renderAdminViews();
    throw error;
  }
};
handleAdminLogin = async function(event) {
  event.preventDefault();
  try {
    applyServerResult(await requestApi('login',{role:'admin',password:document.getElementById('adminInputPassword').value}));
    isAdminLoggedIn=true; currentParticipant=null;currentAssignment=null;
    document.getElementById('adminInputPassword').value='';
    updateHeaderOrg();switchMode('admin');
    document.getElementById('adminLoginError').classList.add('hidden');
  } catch(error) {document.getElementById('adminLoginError').classList.remove('hidden');showToast(error.message,'alert');}
};
handleAdminLogout = async function() {
  await requestApi('logout',{});isAdminLoggedIn=false;currentParticipant=null;currentAssignment=null;
  await loadStateFromStorage();switchMode('admin');
};
handleParticipantLogin = async function(event) {
  event.preventDefault();
  const err=document.getElementById('partLoginError');
  try {
    const birth=document.getElementById('partInputBirth').value.replace(/\D/g,'');
    if(birth.length!==8)throw new Error('생년월일 숫자 8자리를 입력해주세요. 예: 19400101');
    applyServerResult(await requestApi('login',{role:'participant',name:document.getElementById('partInputName').value.trim(),birthDate:birth}));
    isAdminLoggedIn=false;currentParticipant=AppState.participants[0];err.classList.add('hidden');loadParticipantAssignments();
  } catch(error) {err.classList.remove('hidden');document.getElementById('partLoginErrorMsg').innerText=error.message;}
};
const originalParticipantLogout=handleParticipantLogout;
handleParticipantLogout=async function() {
  clearTimeout(autosaveTimer);await saveQueue.catch(()=>{});await requestApi('logout',{});
  originalParticipantLogout();await loadStateFromStorage();updateHeaderOrg();
};
function courseDraft(requireAll=false) {
  const ids=[], signatures={};
  for(const id of currentAssignment.courseIds) {
    const pad=activeSignaturePads[id];
    if(document.getElementById(`checkCourse-${id}`)?.checked && pad?.hasDrawn()) {ids.push(id);signatures[id]=pad.getDataUrl();}
    else if(requireAll)throw new Error('모든 과목의 확인 체크와 이름 서명을 완료해주세요.');
  }
  return {assignDate:currentAssignment.assignDate,completedCourseIds:ids,signatures};
}
function sendDraft(draft) {
  const next=saveQueue.catch(()=>{}).then(async()=>{
    const result=await requestApi('submission',draft);applyServerResult(result);return result;
  });
  saveQueue=next;return next;
}
const originalProgress=updateParticipantProgressBar;
updateParticipantProgressBar=function() {
  originalProgress();
  if(!currentParticipant || !currentAssignment || submitting)return;
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(async()=>{
    try {const draft=courseDraft();if(draft.completedCourseIds.length)await sendDraft(draft);}
    catch(error){showToast('서명을 저장하지 못했습니다. '+error.message,'alert');}
  },600);
};
handleParticipantFinalSubmit=async function() {
  if(submitting || !currentParticipant || !currentAssignment)return;
  try {
    const draft=courseDraft(true);submitting=true;clearTimeout(autosaveTimer);
    await sendDraft(draft);
    document.getElementById('participantCourseCard').classList.add('hidden');
    document.getElementById('participantSuccessCard').classList.remove('hidden');
    document.getElementById('successPartName').innerText=currentParticipant.name;
    document.getElementById('successPartDept').innerText=currentParticipant.dept;
    document.getElementById('successAssignDate').innerText=currentAssignment.assignDate;
    document.getElementById('successSubmitTime').innerText=AppState.submissions.find(s=>s.assignDate===draft.assignDate)?.submittedAt || '';
    showToast('서명이 모두 제출되었습니다.','success');
    if(!document.getElementById('nextEducationButton')){
      const button=document.createElement('button');button.id='nextEducationButton';button.className='w-full text-2xl font-bold p-5 rounded-2xl bg-emerald-700 text-white';button.innerText='다음 교육 서명하기';button.onclick=()=>loadParticipantAssignments();document.getElementById('participantSuccessCard').append(button);
    }
  }catch(error){showToast(error.message,'alert');}
  finally{submitting=false;}
};
const originalLoadAssignments=loadParticipantAssignments;
loadParticipantAssignments=function() {
  const remaining=AppState.assignments.filter(a=>!AppState.submissions.some(s=>s.assignDate===a.assignDate&&a.courseIds.every(id=>s.completedCourseIds.includes(id))));
  if(!remaining.length){showToast('제출할 교육이 없습니다.','info');return;}
  originalLoadAssignments();
};
const originalRenderCourses=renderParticipantCourseCard;
renderParticipantCourseCard=function(){
  originalRenderCourses();
  const sub=AppState.submissions.find(s=>s.assignDate===currentAssignment.assignDate);
  for(const id of sub?.completedCourseIds || []){
    const checkbox=document.getElementById(`checkCourse-${id}`);if(checkbox)checkbox.disabled=true;
    const canvas=document.getElementById(`canvas-${id}`);if(canvas)canvas.style.pointerEvents='none';
    const clear=document.querySelector(`#courseCard-${id} button`);if(clear)clear.disabled=true;
  }
};
toggleManagerReview=async function(id) {try{applyServerResult(await requestApi('review',{id}));renderAdminViews();}catch(error){showToast(error.message,'alert');}};
generateConfirmationPdfBytes=async function(participantId,assignDate) {
  const response=await fetch(`/api/pdf?participant=${encodeURIComponent(participantId)}&date=${encodeURIComponent(assignDate)}`);
  if(!response.ok)throw new Error('확인증을 불러오지 못했습니다.');return new Uint8Array(await response.arrayBuffer());
};
const originalDetail=openSubmissionDetailModal;
openSubmissionDetailModal=function(id,date) {
  originalDetail(id,date);
  const container=document.getElementById('modalReviewActionContainer');
  const button=document.createElement('button');button.textContent='교육 기록 수정';button.className='px-4 py-3 rounded-xl bg-amber-100 font-bold';button.onclick=()=>openCorrection(id,date);container.append(button);
};
function openCorrection(id,date) {
  const sub=AppState.submissions.find(s=>s.participantId===id&&s.assignDate===date);
  if(!sub){showToast('아직 제출한 기록이 없습니다.','alert');return;}
  const content=document.getElementById('modalDetailContent');content.replaceChildren();
  const intro=document.createElement('p');intro.innerText='합계 3시간을 선택하고 각 과목에 기존 서명을 연결하세요. 같은 서명을 두 번 사용할 수 없습니다.';content.append(intro);
  const selected=[];
  OFFICIAL_COURSES.forEach(course=>{
    const row=document.createElement('label');row.className='flex gap-3 items-center p-2';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=course.id;checkbox.checked=sub.completedCourseIds.includes(course.id);
    const text=document.createElement('span');text.textContent=`${course.name} (${course.hours}시간)`;
    const select=document.createElement('select');select.className='border rounded p-1';
    for(const source of sub.completedCourseIds){const option=document.createElement('option');option.value=source;option.textContent=`${OFFICIAL_COURSES.find(c=>c.id===source).name}의 서명`;select.append(option);}
    if(sub.signatures[course.id])select.value=course.id;
    row.append(checkbox,text,select);content.append(row);selected.push({checkbox,select});
  });
  const dateField=document.createElement('input');dateField.type='date';dateField.value=date;dateField.className='border p-2';
  const reason=document.createElement('input');reason.placeholder='수정 사유 (필수)';reason.className='border p-2 w-full';
  const submit=document.createElement('button');submit.textContent='수정하고 확인증 다시 생성';submit.className='p-3 bg-amber-100 rounded font-bold';
  submit.onclick=async()=>{
    submit.disabled=true;
    try{const rows=selected.filter(r=>r.checkbox.checked);const courseIds=rows.map(r=>Number(r.checkbox.value));const mapping=Object.fromEntries(rows.map(r=>[r.checkbox.value,Number(r.select.value)]));applyServerResult(await requestApi('correction',{participantId:id,oldDate:date,date:dateField.value,courseIds,mapping,reason:reason.value.trim()}));closeModal('modalSubmissionDetail');renderAdminViews();showToast('수정 내용과 이력이 저장되었습니다.','success');}
    catch(error){showToast(error.message,'alert');}finally{submit.disabled=false;}
  };
  content.append(document.createElement('hr'),document.createTextNode('교육일: '),dateField,reason,submit);
}
// Existing administrative handlers await server persistence before success messages.
for(const name of ['handleCreateAssignment','handleDeleteAssignment','handleAddParticipantSubmit','handleDeleteParticipant','handleConfirmExcelUpload','saveAdminSettings']) {
  const action=window[name];window[name]=async function(...args){try{return await action(...args);}catch(error){showToast(error.message,'alert');}};
}
// Browser backups can still be exported. Destructive replacement requires a separate migration.
importDataBackup=function(){showToast('기존 백업 이전은 서버에서 검증 후 처리해야 합니다. 현재 파일은 변경되지 않았습니다.','alert');};
handleResetAllData=function(){showToast('전체 초기화는 사용할 수 없습니다. Supabase 백업과 보관 기준을 먼저 확인해주세요.','alert');};
loadSampleDemoData=function(){showToast('운영 명단에는 샘플 데이터를 자동으로 추가하지 않습니다.','info');};
handleCustomPdfUpload=function(){showToast('공식 양식은 변경할 수 없습니다.','alert');};

document.addEventListener('DOMContentLoaded',()=>{
  const birth=document.getElementById('partInputBirth');birth.maxLength=8;birth.placeholder='예: 19400101';birth.inputMode='numeric';
  birth.addEventListener('input',()=>{birth.value=birth.value.replace(/\D/g,'').slice(0,8);});
  document.getElementById('adminInputPassword').placeholder='담당자 비밀번호';
  const next=document.createElement('p');next.className='text-lg';next.textContent='교육을 받은 뒤 이름을 정자로 서명해주세요.';document.getElementById('participantLoginCard').prepend(next);
});
// Refresh shared submissions without changing data while an administrator is editing.
setInterval(async()=>{
  if(!isAdminLoggedIn || activeAdminTab!=='status' || document.hidden)return;
  try {applyServerResult(await requestApi('state'));renderAdminViews();}
  catch(error){showToast(error.message,'alert');}
},15000);

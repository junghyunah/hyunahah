import serverless from 'serverless-http';
import {createApplication} from './server.mjs';

export function createNetlifyHandler(options={}) {
  let application;
  return async function(event,context) {
    // Netlify rewrites retain the external path on some event versions.
    const prefix='/.netlify/functions/api';
    const path=event.path?.startsWith(prefix)?event.path.slice(prefix.length):event.path;
    if(!application)application=createApplication({secureCookies:true,...options}).then(app=>serverless(app.server,{binary:['application/pdf']})).catch(error=>{application=null;throw error;});
    try {
      return await (await application)({...event,path,rawPath:path},context);
    }catch{
      // Do not expose configuration, keys, or database error details.
      return {statusCode:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'서버 연결 설정을 확인해주세요. Supabase SQL과 Netlify 환경변수가 필요합니다.'})};
    }
  };
}
export const handler=createNetlifyHandler();

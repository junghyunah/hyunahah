import { createClient } from '@supabase/supabase-js';

export function createSupabaseStore({url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY}={}) {
  if (!url || !key) throw new Error('서버에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정하세요.');
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  function check(error) {
    if (!error) return;
    if(error.code==='40001')throw Object.assign(new Error('다른 화면에서 데이터가 변경되었습니다. 다시 불러온 뒤 시도해주세요.'),{status:409});
    // 인증 키나 응답 전체를 로그에 남기지 않습니다.
    throw new Error(`Supabase 데이터 작업 실패 (${error.code || 'network'})`);
  }
  return {
    async load() {
      const {data,error}=await client.rpc('load_training_state');
      check(error);return {state:data.state,revision:Number(data.revision),passwordHash:data.password_hash};
    },
    async save({state,revision,documents=[],passwordHash=null}) {
      const {data,error}=await client.rpc('save_training_state',{expected_revision:revision,new_state:state,new_documents:documents.map(d=>({...d,pdf:Buffer.from(d.pdf).toString('base64')})),new_password_hash:passwordHash});
      check(error);return Number(data);
    },
    async document(participant,date) {
      const {data,error}=await client.from('training_documents').select('pdf_base64').eq('participant_id',participant).eq('assign_date',date).order('revision',{ascending:false}).limit(1).maybeSingle();
      check(error);return data?Buffer.from(data.pdf_base64,'base64'):null;
    }
  };
}

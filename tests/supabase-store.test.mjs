import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createSupabaseStore} from '../supabase-store.mjs';

test('Supabase adapter loads state, calls atomic RPC, and reads latest PDF',async t=>{
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const c of req)text+=c;
    requests.push({url:req.url,method:req.method,body:text?JSON.parse(text):null});
    assert.equal(req.headers.apikey,'test-server-key');
    res.writeHead(200,{'Content-Type':'application/json'});
    if(req.url.startsWith('/rest/v1/rpc/load_training_state'))return res.end(JSON.stringify({state:{participants:[]},revision:3,password_hash:'test-hash'}));
    if(req.url.startsWith('/rest/v1/rpc/save_training_state'))return res.end('4');
    if(req.url.startsWith('/rest/v1/training_documents'))return res.end(JSON.stringify({pdf_base64:Buffer.from('%PDF-test').toString('base64')}));
    res.end('null');
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const store=createSupabaseStore({url:`http://127.0.0.1:${server.address().port}`,key:'test-server-key'});
  assert.equal((await store.load()).revision,3);
  assert.equal(await store.save({state:{participants:[]},revision:3,documents:[{participant:'p1',date:'2026-10-01',pdf:Buffer.from('%PDF-test')}]}),4);
  assert.equal((await store.document('p1','2026-10-01')).toString(),'%PDF-test');
  const rpc=requests.find(r=>r.url.includes('save_training_state'));assert.equal(rpc.body.expected_revision,3);assert.equal(rpc.body.new_documents[0].pdf,Buffer.from('%PDF-test').toString('base64'));
  assert.ok(requests.at(-1).url.includes('order=revision.desc'));
});
test('Supabase transaction conflict maps to HTTP 409',async t=>{
  const server=http.createServer((req,res)=>{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'40001',message:'revision_conflict'}));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const store=createSupabaseStore({url:`http://127.0.0.1:${server.address().port}`,key:'test-server-key'});
  await assert.rejects(()=>store.save({state:{},revision:0}),error=>error.status===409);
});

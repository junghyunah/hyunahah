import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNetlifyHandler} from '../netlify-handler.mjs';
import {memoryStore} from './memory-store.mjs';
import {fixture} from './fixture.mjs';

test('Netlify cold instances share sessions, newly added participants, and logout',async()=>{
  const store=memoryStore(fixture());
  const options={store,password:'test-password-12345'};
  const first=createNetlifyHandler(options);
  const call=async(handler,path,data,cookie='')=>{
    const result=await handler({httpMethod:data===undefined?'GET':path==='/api/state'?'PUT':'POST',path:'/.netlify/functions/api'+path,headers:{host:'example.netlify.app',origin:'https://example.netlify.app','content-type':'application/json',cookie},body:data===undefined?null:JSON.stringify(data),isBase64Encoded:false,queryStringParameters:{}},{});
    return {...result,json:JSON.parse(result.body)};
  };
  const login=await call(first,'/api/login',{role:'admin',password:options.password});assert.equal(login.statusCode,200);
  const cookies=login.multiValueHeaders?.['set-cookie']||login.multiValueHeaders?.['Set-Cookie']||[login.headers?.['set-cookie']||login.headers?.['Set-Cookie']];
  const cookie=cookies[0].split(';')[0];assert.match(cookies[0],/Secure/);
  const second=createNetlifyHandler(options);
  const view=await call(second,'/api/state',undefined,cookie);assert.equal(view.statusCode,200);
  view.json.state.participants.push({id:'new-participant',name:'새참여자',birthDate:'19400303',dept:'사업단 1'});
  const saved=await call(second,'/api/state',{state:view.json.state,revision:view.json.revision},cookie);assert.equal(saved.statusCode,200);
  const third=createNetlifyHandler(options);
  const other=await call(third,'/api/login',{role:'participant',name:'새참여자',birthDate:'19400303'});assert.equal(other.statusCode,200);assert.equal(other.json.state.participants[0].id,'new-participant');
  assert.equal((await call(third,'/api/logout',{},cookie)).statusCode,200);
  assert.equal((await call(first,'/api/state',undefined,cookie)).statusCode,401);
});

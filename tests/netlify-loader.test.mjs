import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {memoryStore} from './memory-store.mjs';
import {fixture} from './fixture.mjs';

test('CommonJS Netlify loader imports built ESM runtime and serves a request',async()=>{
  // Reproduce Lambda's require() entry and task root, not just source imports.
  execFileSync(process.execPath,['scripts/build-netlify.mjs'],{cwd:resolve('.'),stdio:'pipe'});
  const old=process.env.LAMBDA_TASK_ROOT;process.env.LAMBDA_TASK_ROOT=resolve('.');
  try {
    const require=createRequire(import.meta.url);
    const module=require('../netlify/functions/api.cjs');
    assert.equal(typeof module.handler,'function');
    const handler=module.createHandler({store:memoryStore(fixture()),password:'test-password-12345'});
    const response=await handler({httpMethod:'GET',path:'/.netlify/functions/api/api/health',headers:{host:'example.netlify.app'},isBase64Encoded:false,queryStringParameters:{}},{});
    assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).ok,true);
  } finally {if(old===undefined)delete process.env.LAMBDA_TASK_ROOT;else process.env.LAMBDA_TASK_ROOT=old;}
});

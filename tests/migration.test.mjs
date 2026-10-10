import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {fixture} from './fixture.mjs';

test('migration permissions, atomic PDF save, rollback, and stale revision',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  const sql=readFileSync(new URL('../supabase/migrations/202610100001_training.sql',import.meta.url),'utf8');
  await db.exec(sql);
  await db.exec(readFileSync(new URL('../supabase/migrations/202610100002_sessions.sql',import.meta.url),'utf8'));
  await db.exec("INSERT INTO public.training_participants(id,name,birth_date,dept) VALUES('legacy','기존참여자','19400101','사업단 1'); GRANT SELECT ON public.training_participants TO anon; CREATE POLICY legacy_open ON public.training_participants FOR ALL USING(true) WITH CHECK(true);");
  await db.exec(sql); // Re-running preserves data and closes existing public policies.
  assert.equal((await db.query("SELECT count(*) AS n FROM public.training_participants WHERE id='legacy'")).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*) AS n FROM pg_policies WHERE schemaname='public'")).rows[0].n,0);
  const rls=await db.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('training_settings','training_participants','training_assignments','training_submissions','training_audit_logs','training_documents','training_sessions')");
  assert.ok(rls.rows.every(row=>row.relrowsecurity));
  await db.exec('SET ROLE anon');
  await assert.rejects(()=>db.query('SELECT * FROM public.training_participants'),e=>e.code==='42501');
  await assert.rejects(()=>db.query("SELECT public.save_training_state(0,'{}')"),e=>e.code==='42501');
  await assert.rejects(()=>db.query('SELECT * FROM public.training_sessions'),e=>e.code==='42501');
  await db.exec('RESET ROLE; SET ROLE service_role');
  const saved=await db.query("SELECT public.save_training_state($1,$2,$3,$4) AS revision",[0,fixture().state,[{participant:'p1',date:'2026-10-01',pdf:'JVBERg=='}],'hash']);
  assert.equal(saved.rows[0].revision,1);
  const loaded=(await db.query('SELECT public.load_training_state() AS data')).rows[0].data;
  assert.equal(loaded.state.participants[0].birthDate,'19400101');
  assert.equal(loaded.state.settings.orgName,'테스트복지관');
  assert.equal(loaded.password_hash,'hash');
  assert.equal((await db.query('SELECT count(*) AS n FROM public.training_documents')).rows[0].n,1);
  await assert.rejects(()=>db.query("SELECT public.save_training_state(0,'{}')"),e=>e.code==='40001');
  await assert.rejects(()=>db.query('SELECT public.save_training_state($1,$2,$3)',[1,fixture().state,[{participant:'p1',date:'invalid',pdf:'JVBERg=='}]]));
  assert.equal((await db.query("SELECT revision FROM public.training_settings WHERE id='default'")).rows[0].revision,1);
});

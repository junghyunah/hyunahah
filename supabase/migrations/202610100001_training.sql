-- 기존 5개 테이블을 유지하는 보완 SQL. 신규 프로젝트에도 실행할 수 있습니다.
-- 실제 적용 전 Supabase에서 기존 데이터 백업을 확보하세요.
begin;
create table if not exists public.training_settings (
  id text primary key, org_name text default '복지관 이름을 설정해주세요',
  depts jsonb default '["사업단 1","사업단 2"]'::jsonb,
  admin_password text, updated_at text
);
create table if not exists public.training_participants (
  id text primary key, name text not null, birth_date text not null,
  dept text not null, phone text, created_at text
);
create table if not exists public.training_assignments (
  id text primary key, target_type text not null, target_dept text,
  participant_id text references public.training_participants(id) on delete cascade,
  assign_date text not null, course_ids jsonb not null,
  total_hours int default 3, created_at text
);
create table if not exists public.training_submissions (
  id text primary key,
  participant_id text references public.training_participants(id) on delete cascade,
  assignment_id text, assign_date text not null,
  completed_course_ids jsonb not null, signatures jsonb,
  submitted_at text not null, reviewed boolean default false, reviewed_at text
);
create table if not exists public.training_audit_logs (
  id text primary key, type text not null, target_id text not null,
  before_data jsonb, after_data jsonb, reason text not null, manager text, created_at text
);
alter table public.training_settings add column if not exists revision bigint not null default 0;
alter table public.training_settings add column if not exists password_hash text;
alter table public.training_submissions add column if not exists saved_at text;
alter table public.training_assignments add column if not exists excluded_participant_ids jsonb not null default '[]'::jsonb;
alter table public.training_settings alter column admin_password drop default;
-- 평문 비밀번호는 사용하지 않으며 기존 값도 제거합니다.
update public.training_settings set admin_password=null;
insert into public.training_settings(id) values('default') on conflict(id) do nothing;
create table if not exists public.training_documents (
  participant_id text not null, assign_date date not null, revision bigint not null,
  pdf_base64 text not null, created_at timestamptz not null default now(),
  primary key(participant_id,assign_date,revision)
);

-- 알려진 공개 정책만이 아니라 대상 테이블의 기존 정책 전체를 제거합니다.
-- 이후 익명/일반 사용자 접근은 차단하고 서버 service_role만 사용합니다.
do $$
declare item record; tab text;
begin
  for item in select tablename,policyname from pg_policies
    where schemaname='public' and tablename in ('training_settings','training_participants','training_assignments','training_submissions','training_audit_logs','training_documents')
  loop execute format('drop policy %I on public.%I',item.policyname,item.tablename); end loop;
  foreach tab in array array['training_settings','training_participants','training_assignments','training_submissions','training_audit_logs','training_documents'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from anon, authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end;
$$;

-- 기존 snake_case 열을 UI의 camelCase 이름으로 변환합니다.
create or replace function public.load_training_state() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'revision',s.revision,'password_hash',s.password_hash,
    'state',jsonb_build_object(
      'settings',jsonb_build_object('orgName',s.org_name,'depts',s.depts),
      'participants',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'birthDate',p.birth_date,'dept',p.dept,'phone',p.phone,'createdAt',p.created_at) order by p.id) from public.training_participants p),'[]'::jsonb),
      'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'targetType',a.target_type,'targetDept',a.target_dept,'participantId',a.participant_id,'assignDate',a.assign_date,'courseIds',a.course_ids,'totalHours',a.total_hours,'createdAt',a.created_at,'excludedParticipantIds',a.excluded_participant_ids) order by a.id) from public.training_assignments a),'[]'::jsonb),
      'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'participantId',t.participant_id,'assignmentId',t.assignment_id,'assignDate',t.assign_date,'completedCourseIds',t.completed_course_ids,'signatures',t.signatures,'submittedAt',t.submitted_at,'savedAt',t.saved_at,'reviewed',t.reviewed,'reviewedAt',t.reviewed_at) order by t.id) from public.training_submissions t),'[]'::jsonb),
      'auditLogs',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'type',l.type,'targetId',l.target_id,'before',l.before_data,'after',l.after_data,'reason',l.reason,'manager',l.manager,'timestamp',l.created_at) order by l.created_at,l.id) from public.training_audit_logs l),'[]'::jsonb),
      'customPdfBase64',null
    )
  ) from public.training_settings s where s.id='default';
$$;

create or replace function public.save_training_state(
  expected_revision bigint, new_state jsonb,
  new_documents jsonb default '[]'::jsonb, new_password_hash text default null
) returns bigint
language plpgsql security invoker set search_path='' as $$
declare next_revision bigint; item jsonb;
begin
  -- 모든 쓰기를 같은 행에서 잠그고, 오래된 저장은 거절합니다.
  update public.training_settings set
    org_name=new_state->'settings'->>'orgName',depts=new_state->'settings'->'depts',
    revision=revision+1,password_hash=coalesce(new_password_hash,password_hash),
    updated_at=now()::text,admin_password=null
    where id='default' and revision=expected_revision returning revision into next_revision;
  if next_revision is null then raise exception 'revision_conflict' using errcode='40001'; end if;

  for item in select value from jsonb_array_elements(new_state->'participants') loop
    insert into public.training_participants(id,name,birth_date,dept,phone,created_at)
    values(item->>'id',item->>'name',item->>'birthDate',item->>'dept',item->>'phone',item->>'createdAt')
    on conflict(id) do update set name=excluded.name,birth_date=excluded.birth_date,dept=excluded.dept,phone=excluded.phone,created_at=excluded.created_at;
  end loop;
  for item in select value from jsonb_array_elements(new_state->'assignments') loop
    insert into public.training_assignments(id,target_type,target_dept,participant_id,assign_date,course_ids,total_hours,created_at,excluded_participant_ids)
    values(item->>'id',item->>'targetType',item->>'targetDept',item->>'participantId',item->>'assignDate',item->'courseIds',(item->>'totalHours')::int,item->>'createdAt',coalesce(item->'excludedParticipantIds','[]'::jsonb))
    on conflict(id) do update set target_type=excluded.target_type,target_dept=excluded.target_dept,participant_id=excluded.participant_id,assign_date=excluded.assign_date,course_ids=excluded.course_ids,total_hours=excluded.total_hours,created_at=excluded.created_at,excluded_participant_ids=excluded.excluded_participant_ids;
  end loop;
  for item in select value from jsonb_array_elements(new_state->'submissions') loop
    insert into public.training_submissions(id,participant_id,assignment_id,assign_date,completed_course_ids,signatures,submitted_at,reviewed,reviewed_at,saved_at)
    values(item->>'id',item->>'participantId',item->>'assignmentId',item->>'assignDate',item->'completedCourseIds',item->'signatures',coalesce(item->>'submittedAt',''),coalesce((item->>'reviewed')::boolean,false),item->>'reviewedAt',item->>'savedAt')
    on conflict(id) do update set participant_id=excluded.participant_id,assignment_id=excluded.assignment_id,assign_date=excluded.assign_date,completed_course_ids=excluded.completed_course_ids,signatures=excluded.signatures,submitted_at=excluded.submitted_at,reviewed=excluded.reviewed,reviewed_at=excluded.reviewed_at,saved_at=excluded.saved_at;
  end loop;
  -- 감사 이력은 기존 행을 변경하거나 삭제하지 않습니다.
  for item in select value from jsonb_array_elements(new_state->'auditLogs') loop
    insert into public.training_audit_logs(id,type,target_id,before_data,after_data,reason,manager,created_at)
    values(item->>'id',item->>'type',coalesce(item->>'targetId','settings'),item->'before',item->'after',coalesce(item->>'reason','담당자 저장'),item->>'manager',item->>'timestamp')
    on conflict(id) do nothing;
  end loop;
  delete from public.training_submissions where id not in (select value->>'id' from jsonb_array_elements(new_state->'submissions'));
  delete from public.training_assignments where id not in (select value->>'id' from jsonb_array_elements(new_state->'assignments'));
  delete from public.training_participants where id not in (select value->>'id' from jsonb_array_elements(new_state->'participants'));
  for item in select value from jsonb_array_elements(new_documents) loop
    insert into public.training_documents(participant_id,assign_date,revision,pdf_base64)
    values(item->>'participant',(item->>'date')::date,next_revision,item->>'pdf');
  end loop;
  return next_revision;
end;
$$;
revoke all on function public.load_training_state() from public, anon, authenticated;
revoke all on function public.save_training_state(bigint,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.load_training_state() to service_role;
grant execute on function public.save_training_state(bigint,jsonb,jsonb,text) to service_role;
commit;

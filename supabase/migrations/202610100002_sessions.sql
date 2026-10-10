-- Netlify 함수 인스턴스가 달라도 같은 로그인 세션을 확인합니다.
begin;
create table if not exists public.training_sessions (
  token_hash text primary key,
  role text not null check(role in ('admin','participant')),
  participant_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.training_sessions enable row level security;
revoke all on public.training_sessions from anon, authenticated;
grant all on public.training_sessions to service_role;
create index if not exists training_sessions_expiry on public.training_sessions(expires_at);
commit;

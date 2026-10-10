-- Archived Alo chat conversations, surfaced in the History page's Chats section.
-- Browser clients read/delete their own rows; the agent Edge Function inserts
-- an archived conversation (service role) when a chat is cleared/ended.
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  title text,
  messages jsonb not null default '[]'
);
create index chat_sessions_user_ended on public.chat_sessions(user_id, ended_at desc);
alter table public.chat_sessions enable row level security;
revoke all on public.chat_sessions from anon, authenticated;
grant select, delete on public.chat_sessions to authenticated;
create policy own_chat_sessions_read on public.chat_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy own_chat_sessions_delete on public.chat_sessions
  for delete to authenticated using (user_id = (select auth.uid()));
grant all on public.chat_sessions to service_role;

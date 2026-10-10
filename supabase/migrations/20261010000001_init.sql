-- NOVA core schema: profiles, user_integrations, agent_tasks, call_sessions.
-- Track A owns this file. The Lovable portal (Track C) only reads these tables via RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created automatically on sign-up.
-- notify_email defaults to the auth email (confirmed before the user can sign in
-- when email confirmation is on) and is NOT user-editable, so results only go to
-- the sign-up address. It is null for email-less sign-ups; such callers are refused.
-- phone_e164 is set by an admin for now (no phone setup in the portal MVP).
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  notify_email text,
  phone_e164   text unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, notify_email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Users may only change their display name.
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- user_integrations: one row per (user, provider). Written by the backend only.
-- ---------------------------------------------------------------------------
create table public.user_integrations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  provider           text not null check (provider in ('gmail', 'google_calendar', 'slack', 'home_assistant')),
  status             text not null default 'not_connected'
                       check (status in ('not_connected', 'pending', 'connected', 'error')),
  manus_connector_id text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, provider)
);

create trigger user_integrations_set_updated_at
  before update on public.user_integrations
  for each row execute function public.set_updated_at();

alter table public.user_integrations enable row level security;

create policy "user_integrations: read own" on public.user_integrations
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- agent_tasks: lifecycle of one delegated Manus task.
--   pending -> submitted -> completed | needs_input | failed
--   pending/submit_failed -> submitted (retry) | failed (gave up)
--   needs_input -> completed | failed (user continued in Manus UI)
-- ---------------------------------------------------------------------------
create table public.agent_tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  vapi_call_id      text,
  vapi_tool_call_id text unique,          -- dedupes Vapi tool-call retries
  intent            text not null check (intent in ('summarize_emails', 'research')),
  prompt            text not null,        -- the user's instruction (not the full Manus prompt)
  user_email        text not null,        -- snapshot of profiles.notify_email at creation
  status            text not null default 'pending'
                      check (status in ('pending', 'submitted', 'submit_failed', 'completed', 'needs_input', 'failed')),
  manus_task_id     text unique,
  manus_task_url    text,
  result            text,
  error_message     text,
  submit_attempts   int not null default 0,
  notify_attempts   int not null default 0,
  last_event_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  notify_claimed_at timestamptz,          -- send in progress (lease; expires after 10 min)
  notified_at       timestamptz           -- set only after a successful send
);

create index agent_tasks_user_created_idx on public.agent_tasks (user_id, created_at desc);
create index agent_tasks_status_updated_idx on public.agent_tasks (status, updated_at);

create trigger agent_tasks_set_updated_at
  before update on public.agent_tasks
  for each row execute function public.set_updated_at();

alter table public.agent_tasks enable row level security;

create policy "agent_tasks: read own" on public.agent_tasks
  for select to authenticated using ((select auth.uid()) = user_id);

-- Portal shows status changes live.
alter publication supabase_realtime add table public.agent_tasks;

-- ---------------------------------------------------------------------------
-- call_sessions: per-Vapi-call PIN verification + lockout. Service role only.
-- ---------------------------------------------------------------------------
create table public.call_sessions (
  vapi_call_id text primary key,
  user_id      uuid references auth.users (id) on delete cascade,
  pin_failures int not null default 0,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index call_sessions_user_created_idx on public.call_sessions (user_id, created_at);

alter table public.call_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Atomic helpers used by Edge Functions (service role only).
-- ---------------------------------------------------------------------------

-- Notification lease: claim -> send -> mark_notified (or release on failure).
-- A crashed sender's lease expires after 10 minutes so reconcile can retry.
-- mark/release only act on the exact lease they were given, so a stale sender
-- can never clear or confirm a newer claim.
create or replace function public.claim_notification(p_task_id uuid)
returns setof public.agent_tasks
language sql
set search_path = ''
as $$
  update public.agent_tasks
     set notify_claimed_at = now()
   where id = p_task_id
     and notified_at is null
     and (notify_claimed_at is null or notify_claimed_at < now() - interval '10 minutes')
     and status in ('completed', 'needs_input', 'failed')
     and notify_attempts < 5
  returning *;
$$;

create or replace function public.mark_notified(p_task_id uuid, p_claimed_at timestamptz)
returns void
language sql
set search_path = ''
as $$
  update public.agent_tasks
     set notified_at = now(),
         notify_claimed_at = null
   where id = p_task_id
     and notify_claimed_at = p_claimed_at;
$$;

-- (error_message is left alone: for failed tasks it holds the user-facing reason.)
create or replace function public.release_notification(p_task_id uuid, p_claimed_at timestamptz)
returns void
language sql
set search_path = ''
as $$
  update public.agent_tasks
     set notify_claimed_at = null,
         notify_attempts = notify_attempts + 1
   where id = p_task_id
     and notify_claimed_at = p_claimed_at;
$$;

create or replace function public.mark_submit_failed(p_task_id uuid, p_error text)
returns int
language sql
set search_path = ''
as $$
  update public.agent_tasks
     set status = 'submit_failed',
         submit_attempts = submit_attempts + 1,
         error_message = left(p_error, 1000)
   where id = p_task_id
     and status in ('pending', 'submit_failed')
  returning submit_attempts;
$$;

-- Reconcile claims its batch by bumping updated_at, so overlapping cron runs
-- never process (and e.g. resubmit) the same row twice.
create or replace function public.claim_reconcile_batch(p_older_than timestamptz, p_limit int default 50)
returns setof public.agent_tasks
language sql
set search_path = ''
as $$
  update public.agent_tasks
     set updated_at = now()
   where id in (
     select id from public.agent_tasks
      where status in ('pending', 'submitted', 'submit_failed', 'needs_input')
        and updated_at < p_older_than
      order by updated_at
      limit p_limit
      for update skip locked
   )
  returning *;
$$;

-- Per-call failure counter (also attributed to the profile for the hourly lockout).
create or replace function public.record_pin_failure(p_call_id text, p_user_id uuid)
returns int
language sql
set search_path = ''
as $$
  insert into public.call_sessions (vapi_call_id, user_id, pin_failures)
  values (p_call_id, p_user_id, 1)
  on conflict (vapi_call_id)
    do update set pin_failures = public.call_sessions.pin_failures + 1
  returning pin_failures;
$$;

create or replace function public.recent_pin_failures(p_user_id uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(pin_failures), 0)::int
    from public.call_sessions
   where user_id = p_user_id
     and created_at > now() - interval '1 hour';
$$;

revoke execute on function public.claim_notification(uuid) from public, anon, authenticated;
revoke execute on function public.mark_notified(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.release_notification(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_reconcile_batch(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.recent_pin_failures(uuid) from public, anon, authenticated;
revoke execute on function public.mark_submit_failed(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_pin_failure(text, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

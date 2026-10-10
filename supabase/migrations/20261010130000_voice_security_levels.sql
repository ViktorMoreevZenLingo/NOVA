-- Voice security levels and access layers (see NOVA_VOICE/README.md → Security levels).
--
-- Layers: L1 caller ID (SMS-verified phone) · L2 PIN · L3 callback to the registered
-- number · L4 approval of the exact action, by phone (Alo calls the registered number,
-- reads the action, asks for the PIN) or in the Alo app. Each request gets a risk level
-- (low / medium / high): high (anything that sends or changes data) always needs L4;
-- the user's setting 'secure' adds L3 to every call.

-- ---------------------------------------------------------------------------
-- Per-user setting, chosen in the Alo app. Missing row = 'standard'.
-- ---------------------------------------------------------------------------
create table public.voice_settings (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  security_level text not null default 'standard' check (security_level in ('standard', 'secure')),
  -- L4 by phone (works without internet). Off = approve only in the app.
  approve_by_call boolean not null default true,
  updated_at     timestamptz not null default now()
);

create trigger voice_settings_set_updated_at
  before update on public.voice_settings
  for each row execute function public.nova_set_updated_at();

alter table public.voice_settings enable row level security;
revoke all on public.voice_settings from anon, authenticated;
grant select, insert on public.voice_settings to authenticated;
grant update (security_level, approve_by_call) on public.voice_settings to authenticated;
create policy "voice_settings: read own" on public.voice_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "voice_settings: insert own" on public.voice_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "voice_settings: update own" on public.voice_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Tasks: new intents, approval states, request parameters and the assessed risk.
-- ---------------------------------------------------------------------------
alter table public.agent_tasks drop constraint agent_tasks_intent_check;
alter table public.agent_tasks add constraint agent_tasks_intent_check
  check (intent in ('research', 'summarize_emails', 'calendar', 'reply_email', 'send_email', 'create_calendar_event'));

alter table public.agent_tasks drop constraint agent_tasks_status_check;
alter table public.agent_tasks add constraint agent_tasks_status_check
  check (status in ('pending', 'submitted', 'submit_failed', 'completed', 'needs_input', 'failed',
                    'awaiting_approval', 'sending', 'rejected'));

alter table public.agent_tasks
  add column params      jsonb not null default '{}'::jsonb,   -- e.g. email_query, or the action to approve
  add column risk_level  text check (risk_level in ('low', 'medium', 'high')),
  add column layers      text[] not null default '{}',         -- layers that were satisfied
  add column approved_at timestamptz,
  add column approved_via text check (approved_via in ('call', 'app')),
  add column approval_call_at timestamptz,                    -- last confirmation call placed
  add column approval_call_attempts int not null default 0;

-- ---------------------------------------------------------------------------
-- Call sessions: callback (L3) bookkeeping.
-- ---------------------------------------------------------------------------
alter table public.call_sessions
  add column via_callback     boolean not null default false,  -- we dialed the registered number
  add column callback_call_id text,                            -- on the inbound call: the callback we started
  add column purpose          text not null default 'inbound'
                                check (purpose in ('inbound', 'secure_callback', 'approval')),
  add column approval_task_id uuid references public.agent_tasks (id) on delete cascade;

-- One confirmation call per task at a time: at most 3 attempts, 15 minutes apart
-- (p_min_gap lets a caller who asks for it get the call sooner). Service role only.
create or replace function public.nova_claim_approval_call(p_task_id uuid, p_min_gap interval default interval '15 minutes')
returns setof public.agent_tasks
language sql
set search_path = ''
as $$
  update public.agent_tasks
     set approval_call_at = now(),
         approval_call_attempts = approval_call_attempts + 1
   where id = p_task_id
     and status = 'awaiting_approval'
     and approval_call_attempts < 3
     and (approval_call_at is null or approval_call_at <= now() - p_min_gap)
  returning *;
$$;

revoke execute on function public.nova_claim_approval_call(uuid, interval) from public, anon, authenticated;

-- Reconcile also looks at approvals (confirmation-call retries) and stuck sends.
create or replace function public.claim_reconcile_batch(p_older_than timestamptz, p_limit int default 50)
returns setof public.agent_tasks
language sql
set search_path = ''
as $$
  update public.agent_tasks
     set updated_at = now()
   where id in (
     select id from public.agent_tasks
      where status in ('pending', 'submitted', 'submit_failed', 'needs_input', 'awaiting_approval', 'sending')
        and updated_at < p_older_than
      order by updated_at
      limit p_limit
      for update skip locked
   )
  returning *;
$$;

-- Registered (confirmed) phone of a user in E.164, for callbacks. Service role only.
create or replace function public.nova_user_phone(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '+' || phone from auth.users
   where id = p_user_id and phone is not null and phone_confirmed_at is not null and deleted_at is null;
$$;

revoke execute on function public.nova_user_phone(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- History mirror: titles for the new intents, approval states.
-- ---------------------------------------------------------------------------
create or replace function public.nova_sync_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title_en text := case new.intent
                       when 'summarize_emails'      then 'Email summary'
                       when 'calendar'              then 'Calendar'
                       when 'reply_email'           then 'Reply to email'
                       when 'send_email'            then 'Send email'
                       when 'create_calendar_event' then 'New calendar event'
                       else 'Research'
                     end;
  v_title_bg text := case new.intent
                       when 'summarize_emails'      then 'Обобщение на имейли'
                       when 'calendar'              then 'Календар'
                       when 'reply_email'           then 'Отговор на имейл'
                       when 'send_email'            then 'Изпращане на имейл'
                       when 'create_calendar_event' then 'Ново събитие'
                       else 'Проучване'
                     end;
  -- The app only distinguishes 'done' (complete) from anything else (in progress).
  v_status   text := case new.status
                       when 'completed'         then 'done'
                       when 'failed'            then 'done'
                       when 'rejected'          then 'done'
                       when 'needs_input'       then 'needs_input'
                       when 'awaiting_approval' then 'needs_input'
                       else 'in_progress'  -- pending, submitted, submit_failed, sending
                     end;
  v_detail   text := left(coalesce(
                       case new.status
                         when 'failed'            then new.error_message
                         when 'rejected'          then coalesce(new.error_message, 'Cancelled. Nothing was sent.')
                         when 'awaiting_approval' then 'Waiting for your approval (by phone or here):' || E'\n' || new.result
                         else new.result
                       end,
                       new.prompt), 20000);
begin
  begin
    insert into public.activity (id, user_id, type, date, status, title, detail)
    values (
      new.id, new.user_id, 'task', new.created_at, v_status,
      jsonb_build_object('en', v_title_en || ': ' || left(new.prompt, 80), 'bg', v_title_bg || ': ' || left(new.prompt, 80)),
      jsonb_build_object('en', v_detail, 'bg', v_detail)
    )
    on conflict (id) do update
      set status = excluded.status,
          detail = excluded.detail;
  exception when others then
    raise warning 'nova_sync_task_activity failed for task %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

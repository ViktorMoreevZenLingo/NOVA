-- Voice security levels and access layers (see NOVA_VOICE/README.md → Security levels).
--
-- Layers, all within the call: L1 caller ID (SMS-verified phone) · L2 PIN · L3 the
-- user's personal verification question · L4 approval of the exact action (Alo reads
-- it back and the caller confirms; or in the Alo app). Each request gets a risk level:
-- high (anything that sends or changes data) needs L3 + L4; the user's setting
-- 'secure' adds L3 to every call. No outbound calls are needed (works without internet).

-- ---------------------------------------------------------------------------
-- Per-user settings, chosen in the Alo app. Missing row = 'standard', no question.
-- The verification answer is stored only as a bcrypt hash and is never readable.
-- ---------------------------------------------------------------------------
create table public.voice_settings (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  security_level           text not null default 'standard' check (security_level in ('standard', 'secure')),
  verification_question    text check (char_length(verification_question) between 5 and 200),
  verification_answer_hash text,
  updated_at               timestamptz not null default now()
);

create trigger voice_settings_set_updated_at
  before update on public.voice_settings
  for each row execute function public.nova_set_updated_at();

alter table public.voice_settings enable row level security;
revoke all on public.voice_settings from anon, authenticated;
grant select (user_id, security_level, verification_question, updated_at) on public.voice_settings to authenticated;
grant insert (user_id, security_level) on public.voice_settings to authenticated;
grant update (security_level) on public.voice_settings to authenticated;
create policy "voice_settings: read own" on public.voice_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "voice_settings: insert own" on public.voice_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "voice_settings: update own" on public.voice_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Answers are compared case-, accent-space-insensitively: "  Rex " = "rex".
create or replace function public.nova_normalize_answer(p_answer text)
returns text
language sql
immutable
set search_path = ''
as $$ select lower(regexp_replace(trim(p_answer), '\s+', ' ', 'g')) $$;

-- Set the verification question + answer (hashed with bcrypt).
-- nova_set_verification: service role / admin for a given user (e.g. demo setup).
-- nova_set_my_verification: the signed-in user, from the Alo app.
create or replace function public.nova_set_verification(p_user_id uuid, p_question text, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(public.nova_normalize_answer(p_answer)) < 2 then
    raise exception 'The answer is too short';
  end if;
  insert into public.voice_settings (user_id, verification_question, verification_answer_hash)
  values (p_user_id, trim(p_question), extensions.crypt(public.nova_normalize_answer(p_answer), extensions.gen_salt('bf')))
  on conflict (user_id) do update
    set verification_question = excluded.verification_question,
        verification_answer_hash = excluded.verification_answer_hash;
end;
$$;

create or replace function public.nova_set_my_verification(p_question text, p_answer text)
returns void
language sql
security definer
set search_path = ''
as $$ select public.nova_set_verification((select auth.uid()), p_question, p_answer) $$;

-- Service role only: does the answer match?
create or replace function public.nova_check_verification(p_user_id uuid, p_answer text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select verification_answer_hash = extensions.crypt(public.nova_normalize_answer(p_answer), verification_answer_hash)
       from public.voice_settings where user_id = p_user_id and verification_answer_hash is not null),
    false);
$$;

revoke execute on function public.nova_set_verification(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.nova_check_verification(uuid, text) from public, anon, authenticated;
revoke execute on function public.nova_set_my_verification(text, text) from public, anon;
grant execute on function public.nova_set_my_verification(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Caller lookup (L1), PROTOTYPE: while SMS verification is paused in Alo, signups
-- are anonymous accounts with a self-declared contact_phone in user metadata. Those
-- are matched too (newest account wins), but an SMS-verified phone always wins, so
-- a self-declared number can never take over a verified account. PIN (L2) and the
-- verification question (L3) still guard everything sensitive.
-- TODO when SMS verification is back: drop the contact_phone branch.
-- ---------------------------------------------------------------------------
create or replace function public.nova_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits)
  select u.id
    from auth.users u, caller c
   where c.digits <> ''
     and u.deleted_at is null
     and (
       (u.phone = c.digits and u.phone_confirmed_at is not null)
       or regexp_replace(coalesce(u.raw_user_meta_data ->> 'contact_phone', ''), '\D', '', 'g') = c.digits
     )
   order by (u.phone = c.digits and u.phone_confirmed_at is not null) desc nulls last, u.created_at desc
   limit 1;
$$;

revoke execute on function public.nova_user_id_by_phone(text) from public, anon, authenticated;

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
  add column params       jsonb not null default '{}'::jsonb,   -- e.g. email_query, or the action to approve
  add column risk_level   text check (risk_level in ('low', 'medium', 'high')),
  add column layers       text[] not null default '{}',         -- layers that were satisfied
  add column approved_at  timestamptz,
  add column approved_via text check (approved_via in ('call', 'app'));

-- ---------------------------------------------------------------------------
-- Call sessions: L3 verification and the action read back for approval (L4).
-- ---------------------------------------------------------------------------
alter table public.call_sessions
  add column question_verified_at timestamptz,                  -- L3 passed on this call
  add column question_failures    int not null default 0,       -- 3 wrong answers lock the call
  add column review_task_id       uuid references public.agent_tasks (id) on delete set null;
                                                                -- the action read back to the caller

create or replace function public.nova_record_question_failure(p_call_id text)
returns int
language sql
set search_path = ''
as $$
  update public.call_sessions set question_failures = question_failures + 1
   where vapi_call_id = p_call_id
  returning question_failures;
$$;

revoke execute on function public.nova_record_question_failure(text) from public, anon, authenticated;

-- Reconcile also expires unapproved actions (24h) and fails sends stuck after approval.
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
                         when 'rejected'          then 'Rejected in the app. Nothing was sent.'
                         when 'awaiting_approval' then 'Waiting for your approval: call Alo and say "approve", or approve it here:' || E'\n' || new.result
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

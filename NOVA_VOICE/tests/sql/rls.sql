-- RLS + helper checks for the phone assistant tables (Alo has its own: supabase/tests/rls.sql). Run against a local stack:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -v ON_ERROR_STOP=1 -f tests/sql/rls.sql
-- Everything runs in a transaction that is rolled back.
begin;

-- Two Alo users (phone sign-up), plus one with an unconfirmed phone.
insert into auth.users (id, phone, phone_confirmed_at, instance_id, aud, role)
values
  ('11111111-1111-4111-8111-111111111111', '359888000001', now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', '359888000002', now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', '359888000003', null,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- Alo's current signup: anonymous users with an unverified contact_phone in metadata
-- (PROTOTYPE: trusted for caller lookup; newest account wins; a verified phone always wins).
insert into auth.users (id, raw_user_meta_data, is_anonymous, created_at, instance_id, aud, role)
values
  ('44444444-4444-4444-8444-444444444444', '{"contact_phone":"+359888000004"}', true, now() - interval '1 day',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('55555555-5555-4555-8555-555555555555', '{"contact_phone":"+359888000004"}', true, now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
do $$ begin
  assert public.nova_user_id_by_phone('+359888000004') = '55555555-5555-4555-8555-555555555555', 'newest signup with that number';
  assert public.nova_user_id_by_phone('') is null, 'empty number never matches';
end $$;

-- A self-declared contact_phone can never take over an SMS-verified number.
insert into auth.users (id, raw_user_meta_data, is_anonymous, created_at, instance_id, aud, role)
values ('66666666-6666-4666-8666-666666666666', '{"contact_phone":"+359888000001"}', true, now() + interval '1 hour',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
do $$ begin
  assert public.nova_user_id_by_phone('+359888000001') = '11111111-1111-4111-8111-111111111111', 'verified phone wins';
end $$;

-- Caller lookup: Vapi's "+359..." format matches; an unconfirmed AUTH phone (no signup number) never matches.
do $$ begin
  assert public.nova_user_id_by_phone('+359888000001') = '11111111-1111-4111-8111-111111111111', 'phone lookup';
  assert public.nova_user_id_by_phone('+359 888 000 002') = '22222222-2222-4222-8222-222222222222', 'phone lookup (spaces)';
  assert public.nova_user_id_by_phone('+359888000003') is null, 'unconfirmed phone must not match';
  assert public.nova_user_id_by_phone('+359888999999') is null, 'unknown phone';
end $$;

insert into public.agent_tasks (user_id, intent, prompt)
values
  ('11111111-1111-4111-8111-111111111111', 'research', 'A task'),
  ('22222222-2222-4222-8222-222222222222', 'research', 'B task');

-- Every task is mirrored into the Alo History (activity), same id.
do $$ begin
  assert (select count(*) from public.activity a join public.agent_tasks t using (id) where a.type = 'task' and a.status = 'in_progress') = 2,
    'tasks must be mirrored into activity';
end $$;
update public.agent_tasks set status = 'submitted' where prompt = 'A task';
update public.agent_tasks set status = 'completed', result = 'All good' where prompt = 'A task';
do $$ begin
  assert (select a.status = 'done' and a.detail ->> 'en' = 'All good' from public.activity a join public.agent_tasks t using (id) where t.prompt = 'A task'),
    'completion must be mirrored';
end $$;
update public.agent_tasks set status = 'pending', result = null where prompt = 'A task';

-- Act as user A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

do $$ begin
  assert (select count(*) from public.agent_tasks) = 1, 'A must see exactly its own task';
  assert (select prompt from public.agent_tasks) = 'A task', 'A sees the wrong task';
  assert (select count(*) from public.activity) = 1, 'A must see only its own history';
  assert (select count(*) from public.call_sessions) = 0, 'call_sessions must be invisible';
end $$;

-- A may not write tasks, call service functions or look up phones.
do $$ begin
  begin
    insert into public.agent_tasks (user_id, intent, prompt)
    values ('11111111-1111-4111-8111-111111111111', 'research', 'x');
    raise exception 'task insert should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_notification(gen_random_uuid());
    raise exception 'claim_notification should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.nova_user_id_by_phone('+359888000002');
    raise exception 'phone lookup should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

update public.agent_tasks set status = 'completed';
do $$ begin
  assert (select status from public.agent_tasks) = 'pending', 'A must not be able to update tasks';
end $$;

-- Security setting: A manages only its own row, and only security_level.
reset role;
insert into public.voice_settings (user_id, security_level) values ('22222222-2222-4222-8222-222222222222', 'secure');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
insert into public.voice_settings (user_id, security_level) values ('11111111-1111-4111-8111-111111111111', 'secure');
update public.voice_settings set security_level = 'standard';
do $$ begin
  assert (select count(*) from public.voice_settings) = 1, 'A sees only its own setting';
  assert (select security_level from public.voice_settings) = 'standard', 'A can change its level';
  begin
    insert into public.voice_settings (user_id) values ('22222222-2222-4222-8222-222222222222');
    raise exception 'inserting a setting for another user should be denied';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    perform public.nova_check_verification('11111111-1111-4111-8111-111111111111', 'x');
    raise exception 'nova_check_verification should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.nova_set_verification('22222222-2222-4222-8222-222222222222', 'Hijack question?', 'x1');
    raise exception 'setting another user''s question should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A sets its own verification question; the answer hash is never readable.
select public.nova_set_my_verification('First pet''s name?', '  Rex ');
do $$ begin
  assert (select verification_question from public.voice_settings) = 'First pet''s name?', 'own question visible';
  begin
    perform verification_answer_hash from public.voice_settings;
    raise exception 'the answer hash must not be readable';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select security_level from public.voice_settings where user_id = '22222222-2222-4222-8222-222222222222') = 'secure',
    'B''s setting untouched';
  assert public.nova_check_verification('11111111-1111-4111-8111-111111111111', 'REX'), 'answer check (normalized)';
  assert not public.nova_check_verification('11111111-1111-4111-8111-111111111111', 'max'), 'wrong answer';
  assert not public.nova_check_verification('22222222-2222-4222-8222-222222222222', 'x1'), 'no question → never verified';
  assert (select verification_answer_hash like '$2a$%' from public.voice_settings where user_id = '11111111-1111-4111-8111-111111111111'),
    'stored as bcrypt';
end $$;

-- Approval tasks are mirrored as "needs input" with the draft in the History detail.
insert into public.agent_tasks (user_id, intent, prompt, status, result, risk_level)
values ('11111111-1111-4111-8111-111111111111', 'reply_email', 'Reply to Ivan', 'awaiting_approval', 'To: ivan@example.com', 'high');
do $$ begin
  assert (select a.status = 'needs_input' and a.detail ->> 'en' like 'Waiting for your approval%'
            from public.activity a join public.agent_tasks t using (id) where t.prompt = 'Reply to Ivan'), 'approval mirrored';
end $$;

-- An approved action in flight shows as in progress.
update public.agent_tasks set status = 'sending' where prompt = 'Reply to Ivan';
do $$ begin
  assert (select a.status = 'in_progress' from public.activity a join public.agent_tasks t using (id) where t.prompt = 'Reply to Ivan'),
    'sending shows as in progress';
end $$;

-- Anonymous users see nothing.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  assert (select count(*) from public.agent_tasks) = 0, 'anon must see no tasks';
  begin
    perform count(*) from public.voice_settings;
    raise exception 'anon must not read voice_settings';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Service-role helpers behave as designed.
reset role;
do $$
declare
  t uuid := (select id from public.agent_tasks where prompt = 'A task');
  u uuid := '11111111-1111-4111-8111-111111111111';
  lease1 timestamptz;
  lease2 timestamptz;
begin
  assert (select count(*) from public.claim_notification(t)) = 0, 'cannot claim a pending task';
  update public.agent_tasks set status = 'completed' where id = t;

  select notify_claimed_at into lease1 from public.claim_notification(t);
  assert lease1 is not null, 'first claim must succeed';
  assert (select count(*) from public.claim_notification(t)) = 0, 'live lease blocks a second claim';

  perform public.release_notification(t, lease1);
  assert (select notify_attempts from public.agent_tasks where id = t) = 1, 'release must count the attempt';

  -- Crash simulation: claim, then let the lease expire; a new claim wins and the stale sender can't touch it.
  perform public.claim_notification(t);
  lease1 := now() - interval '11 minutes';
  update public.agent_tasks set notify_claimed_at = lease1 where id = t;
  select notify_claimed_at into lease2 from public.claim_notification(t);
  assert lease2 is not null and lease2 <> lease1, 'expired lease must be re-claimable';
  perform public.release_notification(t, lease1);
  assert (select notify_claimed_at from public.agent_tasks where id = t) = lease2, 'stale release must be a no-op';
  perform public.mark_notified(t, lease2);
  assert (select notified_at is not null and notify_claimed_at is null from public.agent_tasks where id = t), 'mark_notified';
  assert (select count(*) from public.claim_notification(t)) = 0, 'no claim after delivery';

  -- Reconcile batch claim: second overlapping run gets nothing.
  -- (the updated_at trigger would overwrite the backdated value, so bypass it for setup)
  alter table public.agent_tasks disable trigger agent_tasks_set_updated_at;
  update public.agent_tasks set status = 'submitted', updated_at = now() - interval '1 hour' where prompt = 'B task';
  alter table public.agent_tasks enable trigger agent_tasks_set_updated_at;
  assert (select count(*) from public.claim_reconcile_batch(now() - interval '3 minutes')) = 1, 'batch claims stale row';
  assert (select count(*) from public.claim_reconcile_batch(now() - interval '3 minutes')) = 0, 'overlapping run skips it';

  -- PIN failures: per call and per user.
  assert public.record_pin_failure('call-x', u) = 1 and public.record_pin_failure('call-x', u) = 2, 'per-call counter';
  perform public.record_pin_failure('call-y', u);
  assert public.recent_pin_failures(u) = 3, 'per-user hourly counter';
end $$;

select 'RLS checks passed' as result;
rollback;

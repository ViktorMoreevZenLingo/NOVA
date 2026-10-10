-- RLS checks for the portal contract. Run against a local stack:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -v ON_ERROR_STOP=1 -f tests/sql/rls.sql
-- Everything runs in a transaction that is rolled back.
begin;

-- Two users; the auth trigger creates their profiles.
insert into auth.users (id, email, instance_id, aud, role)
values
  ('11111111-1111-4111-8111-111111111111', 'a@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

do $$ begin
  assert (select count(*) from public.assistant_profiles where notify_email in ('a@example.com', 'b@example.com')) = 2,
    'auth trigger did not create assistant_profiles';
end $$;

insert into public.agent_tasks (user_id, intent, prompt, user_email)
values
  ('11111111-1111-4111-8111-111111111111', 'research', 'A task', 'a@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'research', 'B task', 'b@example.com');

insert into public.user_integrations (user_id, provider, status)
values
  ('11111111-1111-4111-8111-111111111111', 'gmail', 'connected'),
  ('22222222-2222-4222-8222-222222222222', 'gmail', 'not_connected');

-- Act as user A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

do $$ begin
  assert (select count(*) from public.agent_tasks) = 1, 'A must see exactly its own task';
  assert (select prompt from public.agent_tasks) = 'A task', 'A sees the wrong task';
  assert (select count(*) from public.assistant_profiles) = 1, 'A must see only its own profile';
  assert (select count(*) from public.user_integrations) = 1, 'A must see only its own integration';
  assert (select count(*) from public.call_sessions) = 0, 'call_sessions must be invisible';
end $$;

-- A may rename itself...
update public.assistant_profiles set display_name = 'Alice';
do $$ begin
  assert (select display_name from public.assistant_profiles) = 'Alice', 'display_name update failed';
end $$;

-- ...but may not change notify_email, write tasks, or call service functions.
do $$ begin
  begin
    update public.assistant_profiles set notify_email = 'evil@example.com';
    raise exception 'notify_email update should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.agent_tasks (user_id, intent, prompt, user_email)
    values ('11111111-1111-4111-8111-111111111111', 'research', 'x', 'a@example.com');
    raise exception 'task insert should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_notification(gen_random_uuid());
    raise exception 'claim_notification should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

update public.agent_tasks set status = 'completed';
do $$ begin
  assert (select status from public.agent_tasks) = 'pending', 'A must not be able to update tasks';
end $$;

-- Anonymous users see nothing.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  assert (select count(*) from public.agent_tasks) = 0, 'anon must see no tasks';
  assert (select count(*) from public.assistant_profiles) = 0, 'anon must see no profiles';
  assert (select count(*) from public.user_integrations) = 0, 'anon must see no integrations';
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

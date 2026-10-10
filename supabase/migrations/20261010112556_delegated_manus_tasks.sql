-- Isolated from the legacy agent_tasks/reconcile worker while Vapi is developed in parallel.
-- call_sessions is the sole identity handoff; only the voice backend writes verified_at.
create table if not exists public.call_sessions (
  vapi_call_id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  pin_failures integer not null default 0,
  verified_at timestamptz
);
alter table public.call_sessions add column if not exists ended_at timestamptz;
alter table public.call_sessions enable row level security;
revoke all on public.call_sessions from public, anon, authenticated;
grant all on public.call_sessions to service_role;

create table public.alo_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (length(request_id) between 1 and 160),
  request_hash text not null,
  call_id text,
  call_activity_id uuid,
  instruction text not null check (length(instruction) between 1 and 10000),
  start_mode text not null check (start_mode in ('now','after_call','scheduled')),
  run_at timestamptz,
  timezone text not null default 'Europe/Sofia',
  status text not null check (status in ('waiting_call','scheduled','queued','running','needs_input','completed','failed','cancelled')),
  grants jsonb not null default '[]',
  delivery_channels jsonb not null default '[]',
  state jsonb not null default '{"phase":"create","round":0}',
  pending jsonb,
  result text,
  error text,
  manus_task_id text unique,
  manus_task_url text,
  cancel_requested boolean not null default false,
  cancel_stop_done boolean not null default false,
  next_run_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  failures integer not null default 0,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, request_id),
  foreign key (user_id, call_activity_id) references public.activity(user_id,id),
  check (start_mode <> 'scheduled' or run_at is not null),
  check (start_mode <> 'after_call' or call_id is not null)
);
create index alo_tasks_user_date on public.alo_tasks(user_id,created_at desc);
create index alo_tasks_due on public.alo_tasks(next_run_at) where status in ('queued','scheduled','running');
create index alo_tasks_call on public.alo_tasks(call_id) where call_id is not null;
create index alo_tasks_activity on public.alo_tasks(user_id,call_activity_id) where call_activity_id is not null;
alter table public.alo_tasks enable row level security;
revoke all on public.alo_tasks from public, anon, authenticated;
grant select on public.alo_tasks to authenticated;
grant all on public.alo_tasks to service_role;
create policy alo_tasks_owner on public.alo_tasks for select to authenticated using (user_id=(select auth.uid()));

create table public.alo_task_steps (
  task_id uuid not null references public.alo_tasks(id) on delete cascade,
  step_key text not null,
  kind text not null,
  status text not null check (status in ('started','succeeded','uncertain')),
  output jsonb,
  created_at timestamptz not null default now(),
  primary key(task_id, step_key)
);
create table public.alo_task_events (
  event_id text primary key,
  task_id uuid not null references public.alo_tasks(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index alo_task_events_task on public.alo_task_events(task_id);
create table public.alo_task_deliveries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.alo_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check(channel in ('email','callback','sms')),
  status text not null default 'pending' check(status in ('pending','claimed','sent','failed','uncertain')),
  lease_id uuid,
  lease_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique(task_id,channel)
);
create index alo_task_deliveries_owner on public.alo_task_deliveries(user_id);
create index alo_task_deliveries_pending on public.alo_task_deliveries(created_at) where status='pending';
alter table public.alo_task_steps enable row level security;
alter table public.alo_task_events enable row level security;
alter table public.alo_task_deliveries enable row level security;
revoke all on public.alo_task_steps,public.alo_task_events,public.alo_task_deliveries from public,anon,authenticated;
grant all on public.alo_task_steps,public.alo_task_events,public.alo_task_deliveries to service_role;
grant select on public.alo_task_deliveries to authenticated;
create policy alo_deliveries_owner on public.alo_task_deliveries for select to authenticated using(user_id=(select auth.uid()));

create function public.alo_task_mirror() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.activity(id,user_id,type,date,status,title,detail,call)
  values(new.id,new.user_id,'task',new.created_at,new.status,
    jsonb_build_object('en',left(new.instruction,100),'bg',left(new.instruction,100)),
    jsonb_build_object('en',coalesce(new.result,new.error,new.pending->>'question',new.instruction),
                       'bg',coalesce(new.result,new.error,new.pending->>'question',new.instruction),'engine','manus'),new.call_activity_id)
  on conflict(id) do update set status=excluded.status,detail=excluded.detail,call=excluded.call;
  if new.status='completed' then
    insert into public.alo_task_deliveries(task_id,user_id,channel)
      select new.id,new.user_id,value from jsonb_array_elements_text(new.delivery_channels)
      on conflict(task_id,channel) do nothing;
  end if;
  return new;
end $$;
-- AFTER: the parent task must exist before inserting a delivery FK.
create function public.alo_task_touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now(); new.revision:=old.revision+1; return new; end $$;
create trigger alo_task_touch before update on public.alo_tasks for each row execute function public.alo_task_touch();
create trigger alo_task_mirror after insert or update on public.alo_tasks for each row execute function public.alo_task_mirror();

-- All RPCs are invoker-rights and service-only. Locks serialize submit/end-call and cancel/steps.
create function public.alo_task_submit(p_user uuid,p_data jsonb) returns public.alo_tasks language plpgsql set search_path='' as $$
declare t public.alo_tasks; c public.call_sessions; initial text;
begin
  if p_data->>'call_id' is not null then
    select * into c from public.call_sessions where vapi_call_id=p_data->>'call_id' for update;
    if c.user_id is distinct from p_user or c.verified_at is null or c.verified_at < now()-interval '24 hours' then raise exception 'Unverified call'; end if;
  end if;
  select * into t from public.alo_tasks where user_id=p_user and request_id=p_data->>'request_id';
  if found then
    if t.request_hash<>p_data->>'request_hash' then raise exception 'Idempotency conflict'; end if;
    return t;
  end if;
  initial:=case when p_data->>'start_mode'='after_call' and c.ended_at is null then 'waiting_call'
                when p_data->>'start_mode'='scheduled' then 'scheduled' else 'queued' end;
  insert into public.alo_tasks(user_id,request_id,request_hash,call_id,call_activity_id,instruction,start_mode,run_at,timezone,status,grants,delivery_channels)
  values(p_user,p_data->>'request_id',p_data->>'request_hash',p_data->>'call_id',nullif(p_data->>'call_activity_id','')::uuid,
    p_data->>'instruction',p_data->>'start_mode',(p_data->>'run_at')::timestamptz,p_data->>'timezone',initial,p_data->'grants',p_data->'delivery_channels')
  on conflict(user_id,request_id) do nothing returning * into t;
  if not found then
    select * into t from public.alo_tasks where user_id=p_user and request_id=p_data->>'request_id';
    if t.request_hash<>p_data->>'request_hash' then raise exception 'Idempotency conflict'; end if;
  end if;
  return t;
end $$;
create function public.alo_call_ended(p_user uuid,p_call text) returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
  perform 1 from public.call_sessions where vapi_call_id=p_call and user_id=p_user and verified_at is not null for update;
  if not found then raise exception 'Unverified call'; end if;
  update public.call_sessions set ended_at=coalesce(ended_at,now()) where vapi_call_id=p_call;
  update public.alo_tasks set status='queued',next_run_at=now() where call_id=p_call and user_id=p_user and status='waiting_call';
  get diagnostics n=row_count; return n;
end $$;
create function public.alo_task_claim() returns setof public.alo_tasks language sql set search_path='' as $$
  update public.alo_tasks set lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds',
    status=case when cancel_requested then status else 'running' end
  where id=(select id from public.alo_tasks where
    ((status in ('queued','scheduled','running') and (run_at is null or run_at<=now()))
     or (cancel_requested and not cancel_stop_done))
    and next_run_at<=now() and (lease_until is null or lease_until<now())
    order by next_run_at,created_at for update skip locked limit 1)
  returning *;
$$;
create function public.alo_task_save(p_id uuid,p_lease uuid,p_patch jsonb) returns boolean language plpgsql set search_path='' as $$
begin
  update public.alo_tasks set
    status=case when cancel_requested then 'cancelled' else coalesce(p_patch->>'status',status) end,
    state=case when p_patch ? 'state' then p_patch->'state' else state end,
    pending=case when p_patch ? 'pending' then nullif(p_patch->'pending','null') else pending end,
    result=case when p_patch ? 'result' then p_patch->>'result' else result end,
    error=case when p_patch ? 'error' then p_patch->>'error' else error end,
    manus_task_id=coalesce(p_patch->>'manus_task_id',manus_task_id),
    manus_task_url=coalesce(p_patch->>'manus_task_url',manus_task_url),
    cancel_stop_done=coalesce((p_patch->>'cancel_stop_done')::boolean,cancel_stop_done),
    failures=coalesce((p_patch->>'failures')::integer,failures),
    next_run_at=coalesce((p_patch->>'next_run_at')::timestamptz,now()+interval '30 seconds'),
    lease_id=null,lease_until=null
    where id=p_id and lease_id=p_lease and lease_until>now();
  return found;
end $$;
create function public.alo_step_begin(p_id uuid,p_lease uuid,p_key text,p_kind text) returns jsonb language plpgsql set search_path='' as $$
declare s public.alo_task_steps;
begin
  perform 1 from public.alo_tasks where id=p_id and lease_id=p_lease and lease_until>now() and not cancel_requested for update;
  if not found then raise exception 'Lease lost or task cancelled'; end if;
  select * into s from public.alo_task_steps where task_id=p_id and step_key=p_key;
  if found then return jsonb_build_object('fresh',false,'step',to_jsonb(s)); end if;
  insert into public.alo_task_steps(task_id,step_key,kind,status) values(p_id,p_key,p_kind,'started') returning * into s;
  return jsonb_build_object('fresh',true,'step',to_jsonb(s));
end $$;
create function public.alo_step_finish(p_id uuid,p_lease uuid,p_key text,p_output jsonb) returns boolean language plpgsql set search_path='' as $$
begin
  perform 1 from public.alo_tasks where id=p_id and lease_id=p_lease and lease_until>now() for update;
  if not found then return false; end if;
  update public.alo_task_steps set status='succeeded',output=p_output where task_id=p_id and step_key=p_key and status='started';
  return found;
end $$;
create function public.alo_task_command(p_user uuid,p_id uuid,p_revision integer,p_command text,p_data jsonb) returns public.alo_tasks language plpgsql set search_path='' as $$
declare t public.alo_tasks;
begin
  select * into t from public.alo_tasks where id=p_id and user_id=p_user for update;
  if not found then raise exception 'Task not found'; end if;
  if p_command='cancel' then
    if t.status in ('completed','failed','cancelled') then return t; end if;
    update public.alo_tasks set cancel_requested=true,status='cancelled',pending=null,next_run_at=now() where id=p_id returning * into t;
  else
    if t.revision<>p_revision or t.status<>'needs_input' then raise exception 'Task changed; refresh before responding'; end if;
    if t.pending->>'kind'='uncertain' then raise exception 'Uncertain actions require operator reconciliation'; end if;
    if p_command='approve' then
      if t.pending->>'kind'<>'approval' then raise exception 'No action to approve'; end if;
      -- Exact persisted arguments only; approval cannot introduce a new action.
      update public.alo_tasks set grants=grants||jsonb_build_array(jsonb_build_object('tool',pending->'tool','constraints',pending->'args','generated_fields','[]'::jsonb)),
        status='queued',pending=null,next_run_at=now() where id=p_id returning * into t;
    elsif p_command='respond' then
      if t.pending->>'kind' not in ('question','limit','connection') then raise exception 'Answer not expected'; end if;
      update public.alo_tasks set state=case when pending->>'kind'='connection' then state else
        state||jsonb_build_object('phase','reply','reply',p_data->>'answer','round',0,'sequence',coalesce((state->>'sequence')::integer,0)+1) end,
        status='queued',pending=null,error=null,next_run_at=now() where id=p_id returning * into t;
    else raise exception 'Unknown command'; end if;
  end if;
  return t;
end $$;
create function public.alo_delivery_claim(p_channel text) returns setof public.alo_task_deliveries language plpgsql set search_path='' as $$
begin
  -- Expired claims are ambiguous, never automatically redelivered.
  update public.alo_task_deliveries set status='uncertain',error='Delivery outcome unknown; reconcile before retrying.' where status='claimed' and lease_until<now();
  return query update public.alo_task_deliveries set status='claimed',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where id=(select id from public.alo_task_deliveries where status='pending' and channel=p_channel order by created_at for update skip locked limit 1) returning *;
end $$;

revoke execute on function public.alo_task_mirror(),public.alo_task_touch(),public.alo_task_submit(uuid,jsonb),public.alo_call_ended(uuid,text),public.alo_task_claim(),public.alo_task_save(uuid,uuid,jsonb),public.alo_step_begin(uuid,uuid,text,text),public.alo_step_finish(uuid,uuid,text,jsonb),public.alo_task_command(uuid,uuid,integer,text,jsonb),public.alo_delivery_claim(text) from public,anon,authenticated;
grant execute on function public.alo_task_mirror(),public.alo_task_touch(),public.alo_task_submit(uuid,jsonb),public.alo_call_ended(uuid,text),public.alo_task_claim(),public.alo_task_save(uuid,uuid,jsonb),public.alo_step_begin(uuid,uuid,text,text),public.alo_step_finish(uuid,uuid,text,jsonb),public.alo_task_command(uuid,uuid,integer,text,jsonb),public.alo_delivery_claim(text) to service_role;

-- Preload explicitly scoped integration reads before asking Manus to summarize.
create or replace function public.alo_task_submit(p_user uuid,p_data jsonb) returns public.alo_tasks language plpgsql set search_path='' as $$
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
  insert into public.alo_tasks(user_id,request_id,request_hash,call_id,call_activity_id,instruction,start_mode,run_at,timezone,status,grants,delivery_channels,state,pending)
  values(p_user,p_data->>'request_id',p_data->>'request_hash',p_data->>'call_id',nullif(p_data->>'call_activity_id','')::uuid,
    p_data->>'instruction',p_data->>'start_mode',(p_data->>'run_at')::timestamptz,p_data->>'timezone',case when p_data ? 'prepared_action' then 'needs_input' else initial end,p_data->'grants',p_data->'delivery_channels',case when p_data ? 'prepared_action' then jsonb_build_object('phase','tools','round',0,'direct',true,'decision',jsonb_build_object('kind','action','tool',p_data->'prepared_action'->'tool','args',(p_data->'prepared_action'->'args')::text,'text',''))
      else jsonb_build_object('phase','create','round',0,'required_tools',coalesce(p_data->'required_tools','[]'::jsonb)) end || case when p_data ? 'initial_read' then jsonb_build_object('initial_read',p_data->'initial_read') else '{}'::jsonb end || case when p_data ? 'delegation' then jsonb_build_object('delegation',p_data->'delegation') else '{}'::jsonb end,
    case when p_data ? 'prepared_action' then jsonb_build_object('kind','approval','question','Approve this exact action?','tool',p_data->'prepared_action'->'tool','args',p_data->'prepared_action'->'args') else null end)
  on conflict(user_id,request_id) do nothing returning * into t;
  if not found then
    select * into t from public.alo_tasks where user_id=p_user and request_id=p_data->>'request_id';
    if t.request_hash<>p_data->>'request_hash' then raise exception 'Idempotency conflict'; end if;
  end if;
  return t;
end $$;

-- Idempotent per-tool-call approvals; readable only by the trusted backend.
create table public.alo_voice_action_requests (
  call_id text not null references public.call_sessions(vapi_call_id) on delete cascade,
  request_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.alo_tasks(id) on delete cascade,
  decision text not null check (decision in ('approve','reject')),
  created_at timestamptz not null default now(),
  primary key(call_id,request_id)
);
alter table public.alo_voice_action_requests enable row level security;
revoke all on public.alo_voice_action_requests from public,anon,authenticated;
grant all on public.alo_voice_action_requests to service_role;

create function public.alo_voice_decide(p_user uuid,p_call text,p_request text,p_decision text)
returns jsonb language plpgsql set search_path='' as $$
declare c public.call_sessions; t public.alo_tasks; prior public.alo_voice_action_requests; claimed boolean:=false;
begin
  if p_decision not in ('approve','reject') or coalesce(length(p_request),0) not between 1 and 160 then raise exception 'Invalid decision'; end if;
  -- Match submit/end-call lock order: call first, then task.
  select * into c from public.call_sessions where vapi_call_id=p_call for update;
  if not found or c.user_id is distinct from p_user or c.verified_at is null or c.verified_at<now()-interval '24 hours' then raise exception 'Unverified call'; end if;
  select * into prior from public.alo_voice_action_requests where call_id=p_call and request_id=p_request;
  if found then
    if prior.user_id<>p_user or prior.decision<>p_decision then raise exception 'Decision conflict'; end if;
    select * into t from public.alo_tasks where id=prior.task_id and user_id=p_user;
    return jsonb_build_object('task',to_jsonb(t),'claimed',false,'replayed',true);
  end if;
  select * into t from public.alo_tasks where id=c.review_alo_task_id and user_id=p_user for update;
  if not found or t.revision is distinct from c.review_alo_revision or t.status<>'needs_input'
     or t.pending->>'kind' is distinct from 'approval' or t.cancel_requested then raise exception 'Read the current action before approving'; end if;
  t:=public.alo_task_command(p_user,t.id,t.revision,case when p_decision='approve' then 'approve' else 'cancel' end,'{}'::jsonb);
  if p_decision='approve' and t.state->>'direct'='true' and t.status='queued' then
    update public.alo_tasks set status='running',lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds'
    where id=t.id returning * into t;
    claimed:=true;
  end if;
  insert into public.alo_voice_action_requests(call_id,request_id,user_id,task_id,decision) values(p_call,p_request,p_user,t.id,p_decision);
  update public.call_sessions set review_alo_task_id=null,review_alo_revision=null where vapi_call_id=p_call;
  return jsonb_build_object('task',to_jsonb(t),'claimed',claimed,'replayed',false);
end $$;
revoke execute on function public.alo_voice_decide(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.alo_voice_decide(uuid,text,text,text) to service_role;

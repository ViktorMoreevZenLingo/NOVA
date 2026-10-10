-- Exact dictated actions can be reviewed on the same call, without a Manus round trip.
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
      else jsonb_build_object('phase','create','round',0,'required_tools',coalesce(p_data->'required_tools','[]'::jsonb)) end,
    case when p_data ? 'prepared_action' then jsonb_build_object('kind','approval','question','Approve this exact action?','tool',p_data->'prepared_action'->'tool','args',p_data->'prepared_action'->'args') else null end)
  on conflict(user_id,request_id) do nothing returning * into t;
  if not found then
    select * into t from public.alo_tasks where user_id=p_user and request_id=p_data->>'request_id';
    if t.request_hash<>p_data->>'request_hash' then raise exception 'Idempotency conflict'; end if;
  end if;
  return t;
end $$;

-- Approval and connection recovery must retain the original start condition.
create or replace function public.alo_task_command(p_user uuid,p_id uuid,p_revision integer,p_command text,p_data jsonb) returns public.alo_tasks language plpgsql set search_path='' as $$
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
        status=case when start_mode='after_call' and exists(select 1 from public.call_sessions c where c.vapi_call_id=call_id and c.ended_at is null) then 'waiting_call'
          when start_mode='scheduled' and run_at>now() then 'scheduled' else 'queued' end,pending=null,next_run_at=now() where id=p_id returning * into t;
    elsif p_command='respond' then
      if t.pending->>'kind' not in ('question','limit','connection') then raise exception 'Answer not expected'; end if;
      update public.alo_tasks set state=case when pending->>'kind'='connection' then state else
        state||jsonb_build_object('phase','reply','reply',p_data->>'answer','round',0,'sequence',coalesce((state->>'sequence')::integer,0)+1) end,
        status=case when start_mode='after_call' and exists(select 1 from public.call_sessions c where c.vapi_call_id=call_id and c.ended_at is null) then 'waiting_call'
          when start_mode='scheduled' and run_at>now() then 'scheduled' else 'queued' end,pending=null,error=null,next_run_at=now() where id=p_id returning * into t;
    else raise exception 'Unknown command'; end if;
  end if;
  return t;
end $$;

-- Never select an arbitrary anonymous duplicate. Confirmed phone ownership wins;
-- a prototype profile number is usable only when exactly one account matches.
create or replace function public.nova_user_id_by_phone(p_phone text)
returns uuid language sql stable security definer set search_path='' as $$
  with caller as (select regexp_replace(coalesce(p_phone,''), '\D', '', 'g') digits),
  matches as (
    select u.id, (regexp_replace(coalesce(u.phone,''),'\D','','g')=c.digits and u.phone_confirmed_at is not null) confirmed
    from auth.users u, caller c where c.digits<>'' and u.deleted_at is null and
      ((regexp_replace(coalesce(u.phone,''),'\D','','g')=c.digits and u.phone_confirmed_at is not null)
       or regexp_replace(coalesce(u.raw_user_meta_data->>'contact_phone',''),'\D','','g')=c.digits)
  )
  select id from matches where confirmed
  union all
  select id from matches where not exists(select 1 from matches where confirmed) and (select count(*) from matches)=1
  limit 1;
$$;
revoke execute on function public.nova_user_id_by_phone(text) from public,anon,authenticated;
grant execute on function public.nova_user_id_by_phone(text) to service_role;

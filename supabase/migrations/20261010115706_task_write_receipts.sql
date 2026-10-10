-- Known requested writes require provider receipts before a task can complete.
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
  insert into public.alo_tasks(user_id,request_id,request_hash,call_id,call_activity_id,instruction,start_mode,run_at,timezone,status,grants,delivery_channels,state)
  values(p_user,p_data->>'request_id',p_data->>'request_hash',p_data->>'call_id',nullif(p_data->>'call_activity_id','')::uuid,
    p_data->>'instruction',p_data->>'start_mode',(p_data->>'run_at')::timestamptz,p_data->>'timezone',initial,p_data->'grants',p_data->'delivery_channels',jsonb_build_object('phase','create','round',0,'required_tools',coalesce(p_data->'required_tools','[]'::jsonb)))
  on conflict(user_id,request_id) do nothing returning * into t;
  if not found then
    select * into t from public.alo_tasks where user_id=p_user and request_id=p_data->>'request_id';
    if t.request_hash<>p_data->>'request_hash' then raise exception 'Idempotency conflict'; end if;
  end if;
  return t;
end $$;

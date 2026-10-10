-- Align the phone assistant with the Alo app schema (20261010094249_alo_accounts_and_activity):
--   * callers are identified by their verified auth.users.phone (Alo signs users in by SMS OTP)
--   * Alo's public.profiles (name, notes) and public.connections replace our own tables
--   * every phone task is mirrored into public.activity so it shows up in the app's History
--   * migrations are tracked by `supabase db push` again (one shared history)

drop trigger if exists nova_on_auth_user_created on auth.users;
drop function if exists public.nova_handle_new_user();
drop table if exists public.assistant_profiles;
drop table if exists public.user_integrations;
drop table if exists public.nova_schema_migrations;

-- Results are delivered via History + the user's own Gmail, not to a stored address.
alter table public.agent_tasks drop column if exists user_email;

-- ---------------------------------------------------------------------------
-- Caller lookup: Vapi gives "+359888123456", Supabase Auth stores "359888123456".
-- Only confirmed phones count. Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.nova_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
    from auth.users
   where phone = regexp_replace(p_phone, '\D', '', 'g')
     and phone_confirmed_at is not null
     and deleted_at is null
   limit 1;
$$;

revoke execute on function public.nova_user_id_by_phone(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mirror agent_tasks into Alo's activity history (same id, type 'task').
-- The app treats status 'done' as complete; everything else shows as in progress.
-- ---------------------------------------------------------------------------
create or replace function public.nova_sync_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title_en text := case new.intent when 'summarize_emails' then 'Email summary' else 'Research' end;
  v_title_bg text := case new.intent when 'summarize_emails' then 'Обобщение на имейли' else 'Проучване' end;
  -- The app only distinguishes 'done' (complete) from anything else (in progress), so a
  -- failed task is shown as finished; the reason is in detail.
  v_status   text := case new.status
                       when 'completed'   then 'done'
                       when 'failed'      then 'done'
                       when 'needs_input' then 'needs_input'
                       else 'in_progress'
                     end;
  v_detail   text := left(coalesce(
                       case new.status when 'failed' then new.error_message else new.result end,
                       new.prompt), 20000);
begin
  -- History is best-effort: a failure here must never roll back the task itself.
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

revoke execute on function public.nova_sync_task_activity() from public, anon, authenticated;

drop trigger if exists agent_tasks_sync_activity on public.agent_tasks;
create trigger agent_tasks_sync_activity
  after insert or update of status, result, error_message on public.agent_tasks
  for each row execute function public.nova_sync_task_activity();

-- Tasks created before this migration: touch them once so the trigger mirrors them.
update public.agent_tasks set status = status;

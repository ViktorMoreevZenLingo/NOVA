-- Run explicitly AFTER migration, function deployment, secrets, and webhook verification.
-- This is intentionally not a migration: branch pushes must never enable shared workers.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='alo_task_project_url')
     or not exists(select 1 from vault.decrypted_secrets where name='alo_task_worker_secret') then
    raise exception 'Configure alo_task_project_url and alo_task_worker_secret in Vault first';
  end if;
end $$;
select cron.schedule('alo-delegated-task-worker','* * * * *',$job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='alo_task_project_url')||'/functions/v1/task-worker',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='alo_task_worker_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=90000
  );
$job$);

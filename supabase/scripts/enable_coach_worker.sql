-- Run explicitly AFTER the coach migration, function deployment and the Vapi coach/pulse
-- assistants are configured (VAPI_* secrets). Not a migration: branch pushes must never
-- start placing real phone calls. Reuses the reconcile job's Vault secrets.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='project_url')
     or not exists(select 1 from vault.decrypted_secrets where name='cron_secret') then
    raise exception 'Configure project_url and cron_secret in Vault first (the deploy workflow does this)';
  end if;
end $$;
select cron.schedule('nova-coach-worker','* * * * *',$job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/coach-worker',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  );
$job$);
-- To stop all coach/pulse calls: select cron.unschedule('nova-coach-worker');

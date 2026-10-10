-- Every 5 minutes, call the `reconcile` Edge Function. It recovers missed webhooks,
-- retries failed Manus submissions and retries failed notifications.
--
-- Requires two Vault secrets, never committed. The deploy workflow sets them via
-- public.nova_set_vault_secret(); by hand:
--   select public.nova_set_vault_secret('project_url', 'https://<project-ref>.supabase.co');
--   select public.nova_set_vault_secret('cron_secret', '<CRON_SECRET>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Create-or-update a Vault secret by name (idempotent, used by CI).
create or replace function public.nova_set_vault_secret(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

revoke execute on function public.nova_set_vault_secret(text, text) from public, anon, authenticated;

select cron.schedule(
  'nova-reconcile',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Scheduler-neutral reminder invocation foundation. This migration does not schedule a Cron job.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated, service_role;

create or replace function private.invoke_rezervo_reminder_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select nullif(btrim(s.decrypted_secret), '')
    into v_worker_url
  from vault.decrypted_secrets s
  where s.name = 'rezervo_reminder_worker_url'
  limit 1;

  select nullif(btrim(s.decrypted_secret), '')
    into v_cron_secret
  from vault.decrypted_secrets s
  where s.name = 'rezervo_reminder_cron_secret'
  limit 1;

  if v_worker_url is null then
    raise exception 'REMINDER_WORKER_URL_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  if left(v_worker_url, 8) <> 'https://' then
    raise exception 'REMINDER_WORKER_URL_MUST_USE_HTTPS' using errcode = 'P0001';
  end if;
  if v_cron_secret is null then
    raise exception 'REMINDER_CRON_SECRET_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.invoke_rezervo_reminder_worker() from public;
revoke all on function private.invoke_rezervo_reminder_worker() from anon, authenticated, service_role;
grant usage on schema private to postgres;
grant execute on function private.invoke_rezervo_reminder_worker() to postgres;

comment on function private.invoke_rezervo_reminder_worker() is
  'Reads the reminder worker URL and Bearer secret from Vault and queues one pg_net request. Does not schedule cron.';

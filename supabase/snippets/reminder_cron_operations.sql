-- Run these statements manually only after the endpoint is deployed, both Vault
-- secrets are configured, and the runtime-disabled no-op request is verified.

-- Schedule every five minutes (DO NOT run during foundation deployment):
select cron.schedule(
  'rezervo-sms-reminder-worker',
  '*/5 * * * *',
  'select private.invoke_rezervo_reminder_worker();'
);

-- Emergency stop:
select cron.unschedule('rezervo-sms-reminder-worker');

-- Current job configuration:
select *
from cron.job
where jobname = 'rezervo-sms-reminder-worker';

-- Last 20 runs:
select *
from cron.job_run_details
where jobid = (
  select jobid
  from cron.job
  where jobname = 'rezervo-sms-reminder-worker'
)
order by start_time desc
limit 20;

-- pg_net response inspection (the response table can vary by pg_net version):
select id, status_code, timed_out, error_msg, created
from net._http_response
order by created desc
limit 20;

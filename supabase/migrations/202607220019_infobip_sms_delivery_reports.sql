-- Infobip SMS delivery reports and provider-accepted usage accounting.

alter table public.appointment_reminder_deliveries
  add column if not exists provider_status_id integer,
  add column if not exists provider_status_group text,
  add column if not exists provider_status_name text,
  add column if not exists provider_error_code text,
  add column if not exists provider_error_name text,
  add column if not exists provider_error_permanent boolean,
  add column if not exists provider_done_at timestamptz,
  add column if not exists delivery_report_received_at timestamptz;

alter table public.appointment_reminder_deliveries
  drop constraint if exists reminder_delivery_provider_metadata_size;
alter table public.appointment_reminder_deliveries
  add constraint reminder_delivery_provider_metadata_size check (
    (provider_status_group is null or length(provider_status_group) <= 128)
    and (provider_status_name is null or length(provider_status_name) <= 128)
    and (provider_error_code is null or length(provider_error_code) <= 128)
    and (provider_error_name is null or length(provider_error_name) <= 128)
  );

drop index if exists public.reminder_deliveries_salon_usage_idx;
create index reminder_deliveries_salon_usage_idx
  on public.appointment_reminder_deliveries (salon_id, sent_at)
  where sent_at is not null and provider_message_id is not null;

create or replace function public.get_salon_reminder_usage(
  p_salon_id uuid,
  p_at timestamptz default now()
)
returns table(
  salon_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  accepted_count bigint,
  max_monthly_reminders integer,
  remaining integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_count bigint;
  v_limit integer;
begin
  select p.period_start, p.period_end
    into v_start, v_end
  from public.reminder_usage_period(p_salon_id, p_at) p;

  select plan.max_monthly_reminders
    into v_limit
  from public.subscriptions sub
  join public.plans plan on plan.id = sub.plan_id
  where sub.salon_id = p_salon_id;

  select count(*) into v_count
  from public.appointment_reminder_deliveries d
  where d.salon_id = p_salon_id
    and d.sent_at is not null
    and d.provider_message_id is not null
    and d.sent_at >= v_start
    and d.sent_at < v_end;

  return query select p_salon_id, v_start, v_end, v_count, v_limit,
    case when v_limit is null then null
      else greatest(v_limit - v_count::integer, 0) end;
end; $$;
revoke all on function public.get_salon_reminder_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.get_salon_reminder_usage(uuid, timestamptz) to service_role;

create or replace function public.apply_infobip_sms_delivery_report(
  p_provider_message_id text,
  p_status_id integer,
  p_status_group text,
  p_status_name text,
  p_error_code text default null,
  p_error_name text default null,
  p_error_permanent boolean default null,
  p_provider_done_at timestamptz default null,
  p_received_at timestamptz default now()
)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  d public.appointment_reminder_deliveries%rowtype;
  v_group text := upper(btrim(coalesce(p_status_group, '')));
  v_status_name text := nullif(btrim(p_status_name), '');
  v_error_code text := nullif(btrim(p_error_code), '');
  v_error_name text := nullif(btrim(p_error_name), '');
  v_effective_at timestamptz := coalesce(p_provider_done_at, p_received_at);
begin
  if p_provider_message_id is null or length(btrim(p_provider_message_id)) not between 1 and 256
    or length(v_group) not between 1 and 128
    or (v_status_name is not null and length(v_status_name) > 128)
    or (v_error_code is not null and length(v_error_code) > 128)
    or (v_error_name is not null and length(v_error_name) > 128) then
    raise exception 'INVALID_DELIVERY_REPORT_INPUT' using errcode = '22023';
  end if;

  select * into d
  from public.appointment_reminder_deliveries
  where provider = 'infobip' and provider_message_id = btrim(p_provider_message_id)
  for update;

  if not found then return 'ignored_unknown_message'; end if;

  if d.provider_done_at is not null and (
    p_provider_done_at is null or p_provider_done_at < d.provider_done_at
  ) then
    return 'ignored_stale';
  end if;

  if d.provider_done_at is not distinct from p_provider_done_at
    and d.provider_status_id is not distinct from p_status_id
    and d.provider_status_group is not distinct from v_group
    and d.provider_status_name is not distinct from v_status_name
    and d.provider_error_code is not distinct from v_error_code
    and d.provider_error_name is not distinct from v_error_name
    and d.provider_error_permanent is not distinct from p_error_permanent then
    return 'ignored_duplicate';
  end if;

  if d.status = 'delivered' and v_group <> 'DELIVERED' then
    return 'ignored_monotone';
  end if;
  if d.status = 'failed' and v_group = 'PENDING' then
    return 'ignored_monotone';
  end if;

  if v_group = 'DELIVERED' then
    update public.appointment_reminder_deliveries
    set status = 'delivered', delivered_at = coalesce(p_provider_done_at, delivered_at, p_received_at),
        provider_status_id = p_status_id, provider_status_group = v_group,
        provider_status_name = v_status_name, provider_error_code = v_error_code,
        provider_error_name = v_error_name, provider_error_permanent = p_error_permanent,
        provider_done_at = coalesce(p_provider_done_at, provider_done_at),
        delivery_report_received_at = p_received_at,
        last_error_code = null, last_error_message = null
    where id = d.id;
  elsif v_group in ('UNDELIVERABLE', 'EXPIRED', 'REJECTED') then
    update public.appointment_reminder_deliveries
    set status = 'failed', failed_at = coalesce(p_provider_done_at, failed_at, p_received_at),
        provider_status_id = p_status_id, provider_status_group = v_group,
        provider_status_name = v_status_name, provider_error_code = v_error_code,
        provider_error_name = v_error_name, provider_error_permanent = p_error_permanent,
        provider_done_at = coalesce(p_provider_done_at, provider_done_at),
        delivery_report_received_at = p_received_at,
        last_error_code = left('INFOBIP_' || coalesce(v_status_name, v_group), 128),
        last_error_message = left('Infobip delivery report: ' || v_group || coalesce('/' || v_status_name, ''), 1000),
        next_retry_at = null, lease_expires_at = null, claim_token = null
    where id = d.id;
  else
    update public.appointment_reminder_deliveries
    set provider_status_id = p_status_id, provider_status_group = v_group,
        provider_status_name = v_status_name, provider_error_code = v_error_code,
        provider_error_name = v_error_name, provider_error_permanent = p_error_permanent,
        provider_done_at = coalesce(p_provider_done_at, provider_done_at),
        delivery_report_received_at = p_received_at
    where id = d.id;
  end if;

  return 'updated';
end; $$;
revoke all on function public.apply_infobip_sms_delivery_report(text, integer, text, text, text, text, boolean, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_infobip_sms_delivery_report(text, integer, text, text, text, text, boolean, timestamptz, timestamptz) to service_role;

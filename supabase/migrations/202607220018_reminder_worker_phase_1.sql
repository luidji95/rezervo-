-- Reminder worker safety primitives only. No scheduler or provider call is introduced.

alter table public.appointment_reminder_deliveries
  add column if not exists claim_token uuid;

create index if not exists reminder_deliveries_claim_token_idx
  on public.appointment_reminder_deliveries (id, claim_token)
  where status = 'processing';

drop function if exists public.claim_due_appointment_reminders(integer, timestamptz, integer);
create function public.claim_due_appointment_reminders(
  p_batch_size integer default 50,
  p_now timestamptz default now(),
  p_lease_minutes integer default 10
)
returns table(
  delivery_id uuid, salon_id uuid, appointment_id uuid, client_id uuid,
  channel public.reminder_channel, scheduled_for timestamptz,
  appointment_start timestamptz, recipient text, salon_timezone text,
  attempt_count integer, lease_expires_at timestamptz, claim_token uuid
)
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer;
  v_used bigint;
  v_reserved bigint;
begin
  if p_batch_size not between 1 and 500 or p_lease_minutes not between 1 and 60 then
    raise exception 'INVALID_CLAIM_INPUT' using errcode = '22023';
  end if;

  update public.appointment_reminder_deliveries d
  set status = 'cancelled', cancelled_at = p_now, lease_expires_at = null,
      claim_token = null, last_error_code = 'SCHEDULE_INVALIDATED'
  where d.status in ('pending', 'processing', 'retry_scheduled') and exists (
    select 1
    from public.appointments a
    left join public.salon_reminder_settings rs on rs.salon_id = a.salon_id
    where a.id = d.appointment_id and (
      a.status not in ('pending', 'confirmed') or a.start_time <= p_now
      or not coalesce(rs.enabled, false)
      or d.scheduled_for <> a.start_time - make_interval(hours => rs.hours_before)
    )
  );

  update public.appointment_reminder_deliveries
  set status = 'failed', failed_at = p_now, lease_expires_at = null,
      claim_token = null, last_error_code = 'MAX_ATTEMPTS_REACHED'
  where attempt_count >= max_attempts and (
    (status = 'processing' and lease_expires_at < p_now)
    or (status = 'retry_scheduled' and coalesce(next_retry_at, scheduled_for) <= p_now)
  );

  insert into public.appointment_reminder_deliveries(
    salon_id, appointment_id, client_id, reminder_type, channel, scheduled_for,
    appointment_start_snapshot, recipient_snapshot, salon_timezone_snapshot,
    status, skipped_at, last_error_code
  )
  select a.salon_id, a.id, a.client_id, 'appointment_reminder', 'sms',
    a.start_time - make_interval(hours => rs.hours_before), a.start_time,
    case when btrim(c.phone) like '+%'
      then '+' || regexp_replace(c.phone, '[^0-9]', '', 'g')
      else regexp_replace(c.phone, '[^0-9]', '', 'g') end,
    coalesce(nullif(s.timezone, ''), 'Europe/Belgrade'),
    case when length(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')) < 8
      then 'skipped'::public.reminder_delivery_status else 'pending'::public.reminder_delivery_status end,
    case when length(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')) < 8 then p_now end,
    case when length(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')) < 8 then 'MISSING_RECIPIENT' end
  from public.appointments a
  join public.salons s on s.id = a.salon_id
  join public.clients c on c.id = a.client_id and c.salon_id = a.salon_id
  join public.salon_reminder_settings rs on rs.salon_id = a.salon_id and rs.enabled and rs.channel = 'sms'
  join public.subscriptions sub on sub.salon_id = a.salon_id and sub.status in ('active', 'trialing')
  join public.plans plan on plan.id = sub.plan_id and plan.sms_reminders_enabled
  where a.status in ('pending', 'confirmed') and a.start_time > p_now
    and a.start_time - make_interval(hours => rs.hours_before) <= p_now
    and (sub.status <> 'trialing' or sub.trial_ends_at is null or sub.trial_ends_at > p_now)
    and (sub.status <> 'active' or sub.current_period_ends_at is null or sub.current_period_ends_at > p_now)
  on conflict (appointment_id, reminder_type, channel, scheduled_for) do nothing;

  for r in
    select d.*
    from public.appointment_reminder_deliveries d
    join public.appointments a on a.id = d.appointment_id and a.salon_id = d.salon_id
    join public.salon_reminder_settings rs on rs.salon_id = d.salon_id and rs.enabled and rs.channel = d.channel
    join public.subscriptions sub on sub.salon_id = d.salon_id and sub.status in ('active', 'trialing')
    join public.plans plan on plan.id = sub.plan_id and plan.sms_reminders_enabled
    where (
      d.status = 'pending'
      or (d.status = 'retry_scheduled' and coalesce(d.next_retry_at, d.scheduled_for) <= p_now)
      or (d.status = 'processing' and d.lease_expires_at < p_now and d.attempt_count < d.max_attempts)
    )
      and a.status in ('pending', 'confirmed') and a.start_time > p_now
      and d.attempt_count < d.max_attempts
      and d.scheduled_for = a.start_time - make_interval(hours => rs.hours_before)
      and (sub.status <> 'trialing' or sub.trial_ends_at is null or sub.trial_ends_at > p_now)
      and (sub.status <> 'active' or sub.current_period_ends_at is null or sub.current_period_ends_at > p_now)
    order by d.scheduled_for, d.id
    limit p_batch_size
    for update of d skip locked
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reminder-quota:' || r.salon_id::text, 0));
    select u.period_start, u.period_end, u.max_monthly_reminders, u.accepted_count
      into v_start, v_end, v_limit, v_used
    from public.get_salon_reminder_usage(r.salon_id, p_now) u;

    select count(*) into v_reserved
    from public.appointment_reminder_deliveries d
    where d.salon_id = r.salon_id and d.id <> r.id and d.status = 'processing'
      and d.lease_expires_at > p_now and d.scheduled_for >= v_start and d.scheduled_for < v_end;

    if v_limit is not null and v_used + v_reserved >= v_limit then
      update public.appointment_reminder_deliveries
      set status = 'skipped', skipped_at = p_now, lease_expires_at = null,
          claim_token = null, last_error_code = 'QUOTA_EXHAUSTED'
      where id = r.id;
      continue;
    end if;

    update public.appointment_reminder_deliveries d
    set status = 'processing', claimed_at = p_now,
        lease_expires_at = p_now + make_interval(mins => p_lease_minutes),
        last_attempt_at = p_now, attempt_count = d.attempt_count + 1,
        next_retry_at = null, claim_token = gen_random_uuid()
    where d.id = r.id
    returning d.id, d.salon_id, d.appointment_id, d.client_id, d.channel,
      d.scheduled_for, d.appointment_start_snapshot, d.recipient_snapshot,
      d.salon_timezone_snapshot, d.attempt_count, d.lease_expires_at, d.claim_token
    into delivery_id, salon_id, appointment_id, client_id, channel,
      scheduled_for, appointment_start, recipient, salon_timezone,
      attempt_count, lease_expires_at, claim_token;
    return next;
  end loop;
end; $$;
revoke all on function public.claim_due_appointment_reminders(integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_appointment_reminders(integer, timestamptz, integer) to service_role;

create or replace function public.validate_claimed_reminder_for_send(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_now timestamptz default now()
)
returns table(
  is_valid boolean, reason text, delivery_id uuid, salon_id uuid,
  appointment_id uuid, recipient text, appointment_start timestamptz,
  salon_timezone text, salon_name text, service_name text,
  attempt_count integer, max_attempts integer
)
language plpgsql security definer set search_path = '' as $$
declare
  d public.appointment_reminder_deliveries%rowtype;
  v_status text;
  v_start timestamptz;
  v_salon_name text;
  v_timezone text;
  v_service_name text;
  v_settings_enabled boolean;
  v_hours_before integer;
  v_subscription_status text;
  v_trial_ends timestamptz;
  v_period_ends timestamptz;
  v_entitled boolean;
  v_limit integer;
  v_used bigint;
  v_reserved bigint;
begin
  select * into d from public.appointment_reminder_deliveries
  where id = p_delivery_id for update;
  if not found then
    return query select false, 'DELIVERY_NOT_FOUND'::text, p_delivery_id,
      null::uuid, null::uuid, null::text, null::timestamptz,
      null::text, null::text, null::text, null::integer, null::integer;
    return;
  end if;

  if d.status <> 'processing' or d.claim_token is distinct from p_claim_token then
    return query select false, 'CLAIM_EXPIRED'::text, d.id, d.salon_id,
      d.appointment_id, null::text, d.appointment_start_snapshot,
      d.salon_timezone_snapshot, null::text, null::text, d.attempt_count, d.max_attempts;
    return;
  end if;
  if d.lease_expires_at is null or d.lease_expires_at <= p_now then
    return query select false, 'CLAIM_EXPIRED'::text, d.id, d.salon_id,
      d.appointment_id, null::text, d.appointment_start_snapshot,
      d.salon_timezone_snapshot, null::text, null::text, d.attempt_count, d.max_attempts;
    return;
  end if;

  select a.status::text, a.start_time, s.name,
    coalesce(nullif(s.timezone, ''), 'Europe/Belgrade'), service.name,
    coalesce(rs.enabled, false), rs.hours_before, sub.status::text,
    sub.trial_ends_at, sub.current_period_ends_at,
    coalesce(plan.sms_reminders_enabled, false), plan.max_monthly_reminders
  into v_status, v_start, v_salon_name, v_timezone, v_service_name,
    v_settings_enabled, v_hours_before, v_subscription_status,
    v_trial_ends, v_period_ends, v_entitled, v_limit
  from public.appointments a
  join public.salons s on s.id = a.salon_id
  left join public.services service on service.id = a.primary_service_id and service.salon_id = a.salon_id
  left join public.salon_reminder_settings rs on rs.salon_id = a.salon_id and rs.channel = d.channel
  left join public.subscriptions sub on sub.salon_id = a.salon_id
  left join public.plans plan on plan.id = sub.plan_id
  where a.id = d.appointment_id and a.salon_id = d.salon_id
  for update of a;

  reason := case
    when v_status is null then 'APPOINTMENT_NOT_FOUND'
    when v_status = 'cancelled' then 'APPOINTMENT_CANCELLED'
    when v_status not in ('pending', 'confirmed') then 'APPOINTMENT_STATUS_CHANGED'
    when v_start <= p_now then 'APPOINTMENT_IN_PAST'
    when v_start is distinct from d.appointment_start_snapshot
      or v_hours_before is null
      or d.scheduled_for is distinct from v_start - make_interval(hours => v_hours_before)
      then 'APPOINTMENT_RESCHEDULED'
    when not v_settings_enabled then 'REMINDERS_DISABLED'
    when not v_entitled then 'ENTITLEMENT_REQUIRED'
    when v_subscription_status not in ('active', 'trialing') then 'SUBSCRIPTION_INACTIVE'
    when v_subscription_status = 'trialing' and v_trial_ends is not null and v_trial_ends <= p_now then 'SUBSCRIPTION_INACTIVE'
    when v_subscription_status = 'active' and v_period_ends is not null and v_period_ends <= p_now then 'SUBSCRIPTION_INACTIVE'
    when d.recipient_snapshot is null or btrim(d.recipient_snapshot) = '' then 'MISSING_RECIPIENT'
    else 'ELIGIBLE'
  end;

  if reason = 'ELIGIBLE' and v_limit is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reminder-quota:' || d.salon_id::text, 0));
    select u.accepted_count into v_used from public.get_salon_reminder_usage(d.salon_id, p_now) u;
    select count(*) into v_reserved
    from public.appointment_reminder_deliveries other
    where other.salon_id = d.salon_id and other.status = 'processing'
      and other.lease_expires_at > p_now;
    if v_used + v_reserved > v_limit then reason := 'QUOTA_EXHAUSTED'; end if;
  end if;

  if reason <> 'ELIGIBLE' then
    update public.appointment_reminder_deliveries
    set status = 'cancelled', cancelled_at = p_now, lease_expires_at = null,
        claim_token = null, last_error_code = reason
    where id = d.id and status = 'processing' and claim_token = p_claim_token;
  end if;

  return query select reason = 'ELIGIBLE', reason, d.id, d.salon_id,
    d.appointment_id,
    case when reason = 'ELIGIBLE' then d.recipient_snapshot else null end,
    d.appointment_start_snapshot, v_timezone, v_salon_name, v_service_name,
    d.attempt_count, d.max_attempts;
end; $$;
revoke all on function public.validate_claimed_reminder_for_send(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.validate_claimed_reminder_for_send(uuid, uuid, timestamptz) to service_role;

create or replace function public.finalize_claimed_reminder_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_now timestamptz default now(),
  p_provider text default null,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_next_retry_at timestamptz default null
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare d public.appointment_reminder_deliveries%rowtype;
begin
  if p_outcome not in ('sent', 'retry_scheduled', 'failed', 'cancelled') then
    raise exception 'INVALID_FINALIZATION_OUTCOME' using errcode = '22023';
  end if;
  if p_error_message is not null and length(p_error_message) > 1000 then
    raise exception 'ERROR_MESSAGE_TOO_LONG' using errcode = '22023';
  end if;

  select * into d from public.appointment_reminder_deliveries
  where id = p_delivery_id for update;
  if not found or d.status <> 'processing' or d.claim_token is distinct from p_claim_token then
    return false;
  end if;

  if p_outcome = 'sent' then
    if p_provider is null or p_provider_message_id is null then
      raise exception 'PROVIDER_RESULT_REQUIRED' using errcode = '22023';
    end if;
    update public.appointment_reminder_deliveries
    set status = 'sent', provider = p_provider,
        provider_message_id = p_provider_message_id, sent_at = p_now,
        last_error_code = null, last_error_message = null,
        lease_expires_at = null, claim_token = null, next_retry_at = null
    where id = d.id;
    update public.appointments a
    set reminder_sent_at = p_now
    where a.id = d.appointment_id and a.salon_id = d.salon_id
      and a.start_time = d.appointment_start_snapshot
      and a.status in ('pending', 'confirmed');
  elsif p_outcome = 'retry_scheduled' then
    if p_next_retry_at is null or p_next_retry_at <= p_now then
      raise exception 'INVALID_RETRY_TIME' using errcode = '22023';
    end if;
    update public.appointment_reminder_deliveries
    set status = 'retry_scheduled', next_retry_at = p_next_retry_at,
        last_error_code = p_error_code, last_error_message = p_error_message,
        lease_expires_at = null, claim_token = null
    where id = d.id;
  elsif p_outcome = 'failed' then
    update public.appointment_reminder_deliveries
    set status = 'failed', failed_at = p_now,
        last_error_code = p_error_code, last_error_message = p_error_message,
        lease_expires_at = null, claim_token = null, next_retry_at = null
    where id = d.id;
  else
    update public.appointment_reminder_deliveries
    set status = 'cancelled', cancelled_at = p_now,
        last_error_code = p_error_code, last_error_message = p_error_message,
        lease_expires_at = null, claim_token = null, next_retry_at = null
    where id = d.id;
  end if;
  return true;
end; $$;
revoke all on function public.finalize_claimed_reminder_delivery(uuid, uuid, text, timestamptz, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_claimed_reminder_delivery(uuid, uuid, text, timestamptz, text, text, text, text, timestamptz) to service_role;

create or replace function public.recover_accepted_reminder_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text,
  p_sent_at timestamptz default now()
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare d public.appointment_reminder_deliveries%rowtype;
begin
  if p_provider is null or p_provider_message_id is null then return false; end if;
  select * into d from public.appointment_reminder_deliveries where id = p_delivery_id for update;
  if not found then return false; end if;
  if d.status = 'sent' and d.provider = p_provider and d.provider_message_id = p_provider_message_id then
    return true;
  end if;
  if d.status <> 'processing' or d.claim_token is distinct from p_claim_token then return false; end if;

  update public.appointment_reminder_deliveries
  set status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id,
      sent_at = p_sent_at, last_error_code = null, last_error_message = null,
      lease_expires_at = null, claim_token = null, next_retry_at = null
  where id = d.id;
  update public.appointments a set reminder_sent_at = p_sent_at
  where a.id = d.appointment_id and a.salon_id = d.salon_id
    and a.start_time = d.appointment_start_snapshot and a.status in ('pending', 'confirmed');
  return true;
end; $$;
revoke all on function public.recover_accepted_reminder_delivery(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.recover_accepted_reminder_delivery(uuid, uuid, text, text, timestamptz) to service_role;

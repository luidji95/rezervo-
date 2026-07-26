-- Fix PL/pgSQL output-variable collisions in the reminder claim RPC.
-- The function signature and returned contract are intentionally unchanged.

do $audit_existing_claim$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_due_appointment_reminders(integer,timestamp with time zone,integer)'::regprocedure
  )
  into v_definition;

  if v_definition is null then
    raise exception 'REMINDER_CLAIM_FUNCTION_NOT_FOUND';
  end if;

  if v_definition !~* 'where\s+attempt_count\s*>=\s*max_attempts' then
    raise exception 'UNEXPECTED_REMINDER_CLAIM_DEFINITION';
  end if;
end;
$audit_existing_claim$;

create or replace function public.claim_due_appointment_reminders(
  p_batch_size integer default 50,
  p_now timestamptz default now(),
  p_lease_minutes integer default 10
)
returns table(
  delivery_id uuid,
  salon_id uuid,
  appointment_id uuid,
  client_id uuid,
  channel public.reminder_channel,
  scheduled_for timestamptz,
  appointment_start timestamptz,
  recipient text,
  salon_timezone text,
  attempt_count integer,
  lease_expires_at timestamptz,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_monthly_limit integer;
  v_accepted_count bigint;
  v_reserved_count bigint;
begin
  if p_batch_size not between 1 and 500
    or p_lease_minutes not between 1 and 60
  then
    raise exception 'INVALID_CLAIM_INPUT' using errcode = '22023';
  end if;

  update public.appointment_reminder_deliveries as delivery
  set status = 'cancelled',
      cancelled_at = p_now,
      lease_expires_at = null,
      claim_token = null,
      last_error_code = 'SCHEDULE_INVALIDATED'
  where delivery.status in ('pending', 'processing', 'retry_scheduled')
    and exists (
      select 1
      from public.appointments as appointment
      left join public.salon_reminder_settings as reminder_settings
        on reminder_settings.salon_id = appointment.salon_id
      where appointment.id = delivery.appointment_id
        and (
          appointment.status not in ('pending', 'confirmed')
          or appointment.start_time <= p_now
          or not coalesce(reminder_settings.enabled, false)
          or delivery.scheduled_for <>
            appointment.start_time
              - make_interval(hours => reminder_settings.hours_before)
        )
    );

  update public.appointment_reminder_deliveries as delivery
  set status = 'failed',
      failed_at = p_now,
      lease_expires_at = null,
      claim_token = null,
      last_error_code = 'MAX_ATTEMPTS_REACHED'
  where delivery.attempt_count >= delivery.max_attempts
    and (
      (
        delivery.status = 'processing'
        and delivery.lease_expires_at < p_now
      )
      or (
        delivery.status = 'retry_scheduled'
        and coalesce(delivery.next_retry_at, delivery.scheduled_for) <= p_now
      )
    );

  insert into public.appointment_reminder_deliveries (
    salon_id,
    appointment_id,
    client_id,
    reminder_type,
    channel,
    scheduled_for,
    appointment_start_snapshot,
    recipient_snapshot,
    salon_timezone_snapshot,
    status,
    skipped_at,
    last_error_code
  )
  select
    appointment.salon_id,
    appointment.id,
    appointment.client_id,
    'appointment_reminder',
    'sms',
    appointment.start_time
      - make_interval(hours => reminder_settings.hours_before),
    appointment.start_time,
    case
      when btrim(client.phone) like '+%'
        then '+' || regexp_replace(client.phone, '[^0-9]', '', 'g')
      else regexp_replace(client.phone, '[^0-9]', '', 'g')
    end,
    coalesce(nullif(salon.timezone, ''), 'Europe/Belgrade'),
    case
      when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) < 8
        then 'skipped'::public.reminder_delivery_status
      else 'pending'::public.reminder_delivery_status
    end,
    case
      when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) < 8
        then p_now
    end,
    case
      when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) < 8
        then 'MISSING_RECIPIENT'
    end
  from public.appointments as appointment
  join public.salons as salon
    on salon.id = appointment.salon_id
  join public.clients as client
    on client.id = appointment.client_id
    and client.salon_id = appointment.salon_id
  join public.salon_reminder_settings as reminder_settings
    on reminder_settings.salon_id = appointment.salon_id
    and reminder_settings.enabled
    and reminder_settings.channel = 'sms'
  join public.subscriptions as subscription
    on subscription.salon_id = appointment.salon_id
    and subscription.status in ('active', 'trialing')
  join public.plans as plan
    on plan.id = subscription.plan_id
    and plan.sms_reminders_enabled
  where appointment.status in ('pending', 'confirmed')
    and appointment.start_time > p_now
    and appointment.start_time
      - make_interval(hours => reminder_settings.hours_before) <= p_now
    and (
      subscription.status <> 'trialing'
      or subscription.trial_ends_at is null
      or subscription.trial_ends_at > p_now
    )
    and (
      subscription.status <> 'active'
      or subscription.current_period_ends_at is null
      or subscription.current_period_ends_at > p_now
    )
  on conflict on constraint reminder_delivery_schedule_unique do nothing;

  for v_candidate in
    select delivery.*
    from public.appointment_reminder_deliveries as delivery
    join public.appointments as appointment
      on appointment.id = delivery.appointment_id
      and appointment.salon_id = delivery.salon_id
    join public.salon_reminder_settings as reminder_settings
      on reminder_settings.salon_id = delivery.salon_id
      and reminder_settings.enabled
      and reminder_settings.channel = delivery.channel
    join public.subscriptions as subscription
      on subscription.salon_id = delivery.salon_id
      and subscription.status in ('active', 'trialing')
    join public.plans as plan
      on plan.id = subscription.plan_id
      and plan.sms_reminders_enabled
    where (
      delivery.status = 'pending'
      or (
        delivery.status = 'retry_scheduled'
        and coalesce(delivery.next_retry_at, delivery.scheduled_for) <= p_now
      )
      or (
        delivery.status = 'processing'
        and delivery.lease_expires_at < p_now
        and delivery.attempt_count < delivery.max_attempts
      )
    )
      and appointment.status in ('pending', 'confirmed')
      and appointment.start_time > p_now
      and delivery.attempt_count < delivery.max_attempts
      and delivery.scheduled_for =
        appointment.start_time
          - make_interval(hours => reminder_settings.hours_before)
      and (
        subscription.status <> 'trialing'
        or subscription.trial_ends_at is null
        or subscription.trial_ends_at > p_now
      )
      and (
        subscription.status <> 'active'
        or subscription.current_period_ends_at is null
        or subscription.current_period_ends_at > p_now
      )
    order by delivery.scheduled_for, delivery.id
    limit p_batch_size
    for update of delivery skip locked
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'reminder-quota:' || v_candidate.salon_id::text,
        0
      )
    );

    select
      usage.period_start,
      usage.period_end,
      usage.max_monthly_reminders,
      usage.accepted_count
    into
      v_period_start,
      v_period_end,
      v_monthly_limit,
      v_accepted_count
    from public.get_salon_reminder_usage(
      v_candidate.salon_id,
      p_now
    ) as usage;

    select count(*)
    into v_reserved_count
    from public.appointment_reminder_deliveries as reserved_delivery
    where reserved_delivery.salon_id = v_candidate.salon_id
      and reserved_delivery.id <> v_candidate.id
      and reserved_delivery.status = 'processing'
      and reserved_delivery.lease_expires_at > p_now
      and reserved_delivery.scheduled_for >= v_period_start
      and reserved_delivery.scheduled_for < v_period_end;

    if v_monthly_limit is not null
      and v_accepted_count + v_reserved_count >= v_monthly_limit
    then
      update public.appointment_reminder_deliveries as delivery
      set status = 'skipped',
          skipped_at = p_now,
          lease_expires_at = null,
          claim_token = null,
          last_error_code = 'QUOTA_EXHAUSTED'
      where delivery.id = v_candidate.id;
      continue;
    end if;

    update public.appointment_reminder_deliveries as delivery
    set status = 'processing',
        claimed_at = p_now,
        lease_expires_at = p_now + make_interval(mins => p_lease_minutes),
        last_attempt_at = p_now,
        attempt_count = delivery.attempt_count + 1,
        next_retry_at = null,
        claim_token = gen_random_uuid()
    where delivery.id = v_candidate.id
    returning
      delivery.id,
      delivery.salon_id,
      delivery.appointment_id,
      delivery.client_id,
      delivery.channel,
      delivery.scheduled_for,
      delivery.appointment_start_snapshot,
      delivery.recipient_snapshot,
      delivery.salon_timezone_snapshot,
      delivery.attempt_count,
      delivery.lease_expires_at,
      delivery.claim_token
    into
      delivery_id,
      salon_id,
      appointment_id,
      client_id,
      channel,
      scheduled_for,
      appointment_start,
      recipient,
      salon_timezone,
      attempt_count,
      lease_expires_at,
      claim_token;

    return next;
  end loop;
end;
$$;

revoke all on function public.claim_due_appointment_reminders(integer, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_appointment_reminders(integer, timestamptz, integer)
  to service_role;

do $verify_replaced_claim$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_due_appointment_reminders(integer,timestamp with time zone,integer)'::regprocedure
  )
  into v_definition;

  if v_definition ~* 'where\s+attempt_count\s*>=\s*max_attempts'
    or v_definition !~* 'delivery\.attempt_count\s*>=\s*delivery\.max_attempts'
    or v_definition !~* 'on conflict on constraint reminder_delivery_schedule_unique'
  then
    raise exception 'REMINDER_CLAIM_REPLACEMENT_VERIFICATION_FAILED';
  end if;
end;
$verify_replaced_claim$;

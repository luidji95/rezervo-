begin;

create or replace function public.get_salon_reminder_usage(
  p_salon_id uuid,
  p_at timestamptz default pg_catalog.now()
)
returns table(
  salon_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  accepted_count bigint,
  max_monthly_reminders integer,
  remaining integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_count bigint;
  v_limit integer;
  v_access record;
begin
  select period.period_start, period.period_end
    into v_start, v_end
  from public.reminder_usage_period(p_salon_id, p_at) as period;

  select * into v_access
  from public.resolve_salon_access_v1(p_salon_id, p_at);

  select plan.max_monthly_reminders into v_limit
  from public.plans as plan
  where plan.id = v_access.effective_plan_id;

  select count(*) into v_count
  from public.appointment_reminder_deliveries as delivery
  where delivery.salon_id = p_salon_id
    and delivery.sent_at is not null
    and delivery.provider_message_id is not null
    and delivery.sent_at >= v_start
    and delivery.sent_at < v_end;

  return query select p_salon_id, v_start, v_end, v_count, v_limit,
    case when v_limit is null then null
      else greatest(v_limit - v_count::integer, 0) end;
end;
$$;

create or replace function public.preview_due_appointment_reminders(
  p_salon_id uuid default null,
  p_batch_size integer default 50,
  p_now timestamptz default pg_catalog.now()
)
returns table(
  salon_id uuid,
  appointment_id uuid,
  scheduled_for timestamptz,
  eligible boolean,
  reason text,
  recipient_masked text,
  salon_timezone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select appointment.salon_id,
    appointment.id,
    appointment.start_time - make_interval(hours => coalesce(settings.hours_before, 24)),
    coalesce(access.has_full_access, false)
      and coalesce(plan.sms_reminders_enabled, false)
      and coalesce(settings.enabled, false)
      and settings.channel = 'sms'
      and appointment.status in ('pending', 'confirmed')
      and appointment.start_time > p_now
      and appointment.start_time - make_interval(hours => settings.hours_before) <= p_now
      and length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) >= 8
      and (usage.remaining is null or usage.remaining > 0),
    case
      when settings.id is null or not settings.enabled then 'REMINDERS_DISABLED'
      when not coalesce(access.has_full_access, false)
        or not coalesce(plan.sms_reminders_enabled, false) then 'ENTITLEMENT_REQUIRED'
      when appointment.status not in ('pending', 'confirmed') then 'APPOINTMENT_NOT_ELIGIBLE'
      when appointment.start_time <= p_now then 'APPOINTMENT_IN_PAST'
      when appointment.start_time - make_interval(hours => settings.hours_before) > p_now then 'NOT_DUE'
      when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) < 8 then 'MISSING_RECIPIENT'
      when usage.remaining = 0 then 'QUOTA_EXHAUSTED'
      else 'ELIGIBLE'
    end,
    case when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) >= 8
      then left(regexp_replace(client.phone, '[^0-9]', '', 'g'), 4)
        || '*****' || right(regexp_replace(client.phone, '[^0-9]', '', 'g'), 3)
      else null end,
    coalesce(nullif(salon.timezone, ''), 'Europe/Belgrade')
  from public.appointments as appointment
  join public.salons as salon on salon.id = appointment.salon_id
  left join public.clients as client
    on client.id = appointment.client_id and client.salon_id = appointment.salon_id
  left join public.salon_reminder_settings as settings on settings.salon_id = appointment.salon_id
  left join lateral public.resolve_salon_access_v1(appointment.salon_id, p_now) as access on true
  left join public.plans as plan on plan.id = access.effective_plan_id
  left join lateral public.get_salon_reminder_usage(appointment.salon_id, p_now) as usage on true
  where (p_salon_id is null or appointment.salon_id = p_salon_id)
    and appointment.start_time > p_now - interval '7 days'
  order by appointment.start_time
  limit least(greatest(p_batch_size, 1), 500);
$$;

create or replace function public.claim_due_appointment_reminders(
  p_batch_size integer default 50,
  p_now timestamptz default pg_catalog.now(),
  p_lease_minutes integer default 10
)
returns table(
  delivery_id uuid, salon_id uuid, appointment_id uuid, client_id uuid,
  channel public.reminder_channel, scheduled_for timestamptz,
  appointment_start timestamptz, recipient text, salon_timezone text,
  attempt_count integer, lease_expires_at timestamptz, claim_token uuid
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
  if p_batch_size not between 1 and 500 or p_lease_minutes not between 1 and 60 then
    raise exception 'INVALID_CLAIM_INPUT' using errcode = '22023';
  end if;

  update public.appointment_reminder_deliveries as delivery
  set status='cancelled', cancelled_at=p_now, lease_expires_at=null,
      claim_token=null, last_error_code='SCHEDULE_INVALIDATED'
  where delivery.status in ('pending','processing','retry_scheduled') and exists (
    select 1 from public.appointments as appointment
    left join public.salon_reminder_settings as settings on settings.salon_id=appointment.salon_id
    where appointment.id=delivery.appointment_id and (
      appointment.status not in ('pending','confirmed') or appointment.start_time <= p_now
      or not coalesce(settings.enabled,false)
      or delivery.scheduled_for <> appointment.start_time-make_interval(hours=>settings.hours_before)
    )
  );

  update public.appointment_reminder_deliveries as delivery
  set status='failed', failed_at=p_now, lease_expires_at=null, claim_token=null,
      last_error_code='MAX_ATTEMPTS_REACHED'
  where delivery.attempt_count >= delivery.max_attempts and (
    (delivery.status='processing' and delivery.lease_expires_at < p_now)
    or (delivery.status='retry_scheduled' and coalesce(delivery.next_retry_at,delivery.scheduled_for) <= p_now)
  );

  insert into public.appointment_reminder_deliveries(
    salon_id,appointment_id,client_id,reminder_type,channel,scheduled_for,
    appointment_start_snapshot,recipient_snapshot,salon_timezone_snapshot,
    status,skipped_at,last_error_code
  )
  select appointment.salon_id, appointment.id, appointment.client_id,
    'appointment_reminder','sms',
    appointment.start_time-make_interval(hours=>settings.hours_before),
    appointment.start_time,
    case when btrim(client.phone) like '+%' then '+'||regexp_replace(client.phone,'[^0-9]','','g')
      else regexp_replace(client.phone,'[^0-9]','','g') end,
    coalesce(nullif(salon.timezone,''),'Europe/Belgrade'),
    case when length(regexp_replace(coalesce(client.phone,''),'[^0-9]','','g')) < 8
      then 'skipped'::public.reminder_delivery_status else 'pending'::public.reminder_delivery_status end,
    case when length(regexp_replace(coalesce(client.phone,''),'[^0-9]','','g')) < 8 then p_now end,
    case when length(regexp_replace(coalesce(client.phone,''),'[^0-9]','','g')) < 8 then 'MISSING_RECIPIENT' end
  from public.appointments as appointment
  join public.salons as salon on salon.id=appointment.salon_id
  join public.clients as client on client.id=appointment.client_id and client.salon_id=appointment.salon_id
  join public.salon_reminder_settings as settings
    on settings.salon_id=appointment.salon_id and settings.enabled and settings.channel='sms'
  join lateral public.resolve_salon_access_v1(appointment.salon_id,p_now) as access
    on access.has_full_access
  join public.plans as plan on plan.id=access.effective_plan_id and plan.sms_reminders_enabled
  where appointment.status in ('pending','confirmed')
    and appointment.start_time > p_now
    and appointment.start_time-make_interval(hours=>settings.hours_before) <= p_now
  on conflict on constraint reminder_delivery_schedule_unique do nothing;

  for v_candidate in
    select delivery.*
    from public.appointment_reminder_deliveries as delivery
    join public.appointments as appointment
      on appointment.id=delivery.appointment_id and appointment.salon_id=delivery.salon_id
    join public.salon_reminder_settings as settings
      on settings.salon_id=delivery.salon_id and settings.enabled and settings.channel=delivery.channel
    join lateral public.resolve_salon_access_v1(delivery.salon_id,p_now) as access
      on access.has_full_access
    join public.plans as plan on plan.id=access.effective_plan_id and plan.sms_reminders_enabled
    where (
      delivery.status='pending'
      or (delivery.status='retry_scheduled' and coalesce(delivery.next_retry_at,delivery.scheduled_for) <= p_now)
      or (delivery.status='processing' and delivery.lease_expires_at < p_now and delivery.attempt_count < delivery.max_attempts)
    )
      and appointment.status in ('pending','confirmed')
      and appointment.start_time > p_now
      and delivery.attempt_count < delivery.max_attempts
      and delivery.scheduled_for=appointment.start_time-make_interval(hours=>settings.hours_before)
    order by delivery.scheduled_for,delivery.id
    limit p_batch_size
    for update of delivery skip locked
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('reminder-quota:'||v_candidate.salon_id::text,0)
    );
    select usage.period_start,usage.period_end,usage.max_monthly_reminders,usage.accepted_count
      into v_period_start,v_period_end,v_monthly_limit,v_accepted_count
    from public.get_salon_reminder_usage(v_candidate.salon_id,p_now) as usage;
    select count(*) into v_reserved_count
    from public.appointment_reminder_deliveries as reserved
    where reserved.salon_id=v_candidate.salon_id and reserved.id<>v_candidate.id
      and reserved.status='processing' and reserved.lease_expires_at>p_now
      and reserved.scheduled_for>=v_period_start and reserved.scheduled_for<v_period_end;
    if v_monthly_limit is not null and v_accepted_count+v_reserved_count>=v_monthly_limit then
      update public.appointment_reminder_deliveries set status='skipped',skipped_at=p_now,
        lease_expires_at=null,claim_token=null,last_error_code='QUOTA_EXHAUSTED'
      where id=v_candidate.id;
      continue;
    end if;
    update public.appointment_reminder_deliveries as delivery
    set status='processing',claimed_at=p_now,
      lease_expires_at=p_now+make_interval(mins=>p_lease_minutes),
      last_attempt_at=p_now,attempt_count=delivery.attempt_count+1,
      next_retry_at=null,claim_token=extensions.gen_random_uuid()
    where delivery.id=v_candidate.id
    returning delivery.id,delivery.salon_id,delivery.appointment_id,delivery.client_id,
      delivery.channel,delivery.scheduled_for,delivery.appointment_start_snapshot,
      delivery.recipient_snapshot,delivery.salon_timezone_snapshot,delivery.attempt_count,
      delivery.lease_expires_at,delivery.claim_token
    into delivery_id,salon_id,appointment_id,client_id,channel,scheduled_for,
      appointment_start,recipient,salon_timezone,attempt_count,lease_expires_at,claim_token;
    return next;
  end loop;
end;
$$;

create or replace function public.validate_claimed_reminder_for_send(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table(
  is_valid boolean, reason text, delivery_id uuid, salon_id uuid,
  appointment_id uuid, recipient text, appointment_start timestamptz,
  salon_timezone text, salon_name text, service_name text,
  attempt_count integer, max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.appointment_reminder_deliveries%rowtype;
  v_status text;
  v_start timestamptz;
  v_salon_name text;
  v_timezone text;
  v_service_name text;
  v_settings_enabled boolean;
  v_hours_before integer;
  v_has_full_access boolean;
  v_reminders_enabled boolean;
  v_limit integer;
  v_used bigint;
  v_reserved bigint;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select * into v_delivery from public.appointment_reminder_deliveries
  where id=p_delivery_id for update;
  if not found then
    return query select false,'DELIVERY_NOT_FOUND'::text,p_delivery_id,null::uuid,
      null::uuid,null::text,null::timestamptz,null::text,null::text,null::text,
      null::integer,null::integer;
    return;
  end if;
  if v_delivery.status<>'processing' or v_delivery.claim_token is distinct from p_claim_token
    or v_delivery.lease_expires_at is null or v_delivery.lease_expires_at<=p_now then
    return query select false,'CLAIM_EXPIRED'::text,v_delivery.id,v_delivery.salon_id,
      v_delivery.appointment_id,null::text,v_delivery.appointment_start_snapshot,
      v_delivery.salon_timezone_snapshot,null::text,null::text,
      v_delivery.attempt_count,v_delivery.max_attempts;
    return;
  end if;

  select appointment.status::text,appointment.start_time,salon.name,
    coalesce(nullif(salon.timezone,''),'Europe/Belgrade'),service.name,
    coalesce(settings.enabled,false),settings.hours_before,
    coalesce(access.has_full_access,false),coalesce(plan.sms_reminders_enabled,false),
    plan.max_monthly_reminders
  into v_status,v_start,v_salon_name,v_timezone,v_service_name,
    v_settings_enabled,v_hours_before,v_has_full_access,v_reminders_enabled,v_limit
  from public.appointments as appointment
  join public.salons as salon on salon.id=appointment.salon_id
  left join public.services as service
    on service.id=appointment.primary_service_id and service.salon_id=appointment.salon_id
  left join public.salon_reminder_settings as settings
    on settings.salon_id=appointment.salon_id and settings.channel=v_delivery.channel
  left join lateral public.resolve_salon_access_v1(appointment.salon_id,p_now) as access on true
  left join public.plans as plan on plan.id=access.effective_plan_id
  where appointment.id=v_delivery.appointment_id and appointment.salon_id=v_delivery.salon_id
  for update of appointment;

  reason := case
    when v_status is null then 'APPOINTMENT_NOT_FOUND'
    when v_status='cancelled' then 'APPOINTMENT_CANCELLED'
    when v_status not in ('pending','confirmed') then 'APPOINTMENT_STATUS_CHANGED'
    when v_start<=p_now then 'APPOINTMENT_IN_PAST'
    when v_start is distinct from v_delivery.appointment_start_snapshot
      or v_hours_before is null
      or v_delivery.scheduled_for is distinct from v_start-make_interval(hours=>v_hours_before)
      then 'APPOINTMENT_RESCHEDULED'
    when not v_settings_enabled then 'REMINDERS_DISABLED'
    when not v_has_full_access or not v_reminders_enabled then 'ENTITLEMENT_REQUIRED'
    when v_delivery.recipient_snapshot is null or btrim(v_delivery.recipient_snapshot)='' then 'MISSING_RECIPIENT'
    else 'ELIGIBLE'
  end;

  if reason='ELIGIBLE' and v_limit is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('reminder-quota:'||v_delivery.salon_id::text,0)
    );
    select usage.accepted_count,usage.period_start,usage.period_end
    into v_used,v_period_start,v_period_end
    from public.get_salon_reminder_usage(v_delivery.salon_id,p_now) as usage;
    select count(*) into v_reserved
    from public.appointment_reminder_deliveries as other
    where other.salon_id=v_delivery.salon_id and other.status='processing'
      and other.lease_expires_at>p_now
      and other.scheduled_for>=v_period_start
      and other.scheduled_for<v_period_end;
    if v_used+v_reserved>v_limit then reason:='QUOTA_EXHAUSTED'; end if;
  end if;

  if reason<>'ELIGIBLE' then
    update public.appointment_reminder_deliveries
    set status='cancelled',cancelled_at=p_now,lease_expires_at=null,
      claim_token=null,last_error_code=reason
    where id=v_delivery.id and status='processing' and claim_token=p_claim_token;
  end if;

  return query select reason='ELIGIBLE',reason,v_delivery.id,v_delivery.salon_id,
    v_delivery.appointment_id,
    case when reason='ELIGIBLE' then v_delivery.recipient_snapshot else null end,
    v_delivery.appointment_start_snapshot,v_timezone,v_salon_name,v_service_name,
    v_delivery.attempt_count,v_delivery.max_attempts;
end;
$$;

revoke all on function public.get_salon_reminder_usage(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.preview_due_appointment_reminders(uuid,integer,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_due_appointment_reminders(integer,timestamptz,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.validate_claimed_reminder_for_send(uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

grant execute on function public.get_salon_reminder_usage(uuid,timestamptz) to service_role;
grant execute on function public.preview_due_appointment_reminders(uuid,integer,timestamptz) to service_role;
grant execute on function public.claim_due_appointment_reminders(integer,timestamptz,integer) to service_role;
grant execute on function public.validate_claimed_reminder_for_send(uuid,uuid,timestamptz) to service_role;

comment on function public.claim_due_appointment_reminders(integer,timestamptz,integer)
  is 'Claims due reminders only when canonical salon access and effective-plan reminder capability are active.';
comment on function public.validate_claimed_reminder_for_send(uuid,uuid,timestamptz)
  is 'Revalidates appointment, lease, canonical access and effective-plan reminder capability immediately before provider send.';

commit;

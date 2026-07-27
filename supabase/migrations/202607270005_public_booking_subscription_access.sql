begin;

create or replace function public.resolve_salon_access_v1(
  p_salon_id uuid,
  p_now timestamptz default now()
)
returns table (
  has_full_access boolean,
  access_mode text,
  access_reason text,
  access_source text,
  effective_plan_id uuid,
  effective_plan_slug text,
  subscription_status text,
  access_ends_at timestamptz,
  is_legacy_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_override record;
  v_subscription record;
begin
  select o.plan_id, o.ends_at, p.slug
    into v_override
  from public.billing_access_overrides o
  join public.plans p on p.id = o.plan_id
  where o.salon_id = p_salon_id
    and o.enabled = true
    and o.starts_at <= p_now
    and (o.ends_at is null or o.ends_at > p_now)
  limit 1;

  select s.status, s.trial_ends_at, s.current_period_ends_at,
         p.id as plan_id, p.slug
    into v_subscription
  from public.subscriptions s
  left join public.plans p on p.id = s.plan_id
  where s.salon_id = p_salon_id
  limit 1;

  if v_override.plan_id is not null then
    return query select true, 'full'::text, 'billing_override'::text,
      'billing_override'::text, v_override.plan_id, v_override.slug::text,
      v_subscription.status::text, v_override.ends_at, false;
    return;
  end if;

  if v_subscription.status is null then
    return query select false, 'read_only'::text, 'subscription_missing'::text,
      'subscription'::text, null::uuid, null::text, null::text,
      null::timestamptz, false;
    return;
  end if;

  if v_subscription.plan_id is null then
    return query select false, 'read_only'::text, 'plan_missing'::text,
      'subscription'::text, null::uuid, null::text, v_subscription.status::text,
      null::timestamptz, false;
    return;
  end if;

  if v_subscription.status = 'trialing'::public.subscription_status then
    return query select
      v_subscription.trial_ends_at is not null and v_subscription.trial_ends_at > p_now,
      case when v_subscription.trial_ends_at is not null and v_subscription.trial_ends_at > p_now then 'full' else 'read_only' end,
      case when v_subscription.trial_ends_at is null then 'invalid_trial_period'
           when v_subscription.trial_ends_at > p_now then 'active_trial'
           else 'trial_expired' end,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.trial_ends_at, false;
  elsif v_subscription.status = 'active'::public.subscription_status then
    return query select
      v_subscription.current_period_ends_at is null or v_subscription.current_period_ends_at > p_now,
      case when v_subscription.current_period_ends_at is null or v_subscription.current_period_ends_at > p_now then 'full' else 'read_only' end,
      case when v_subscription.current_period_ends_at is null then 'legacy_active_no_period'
           when v_subscription.current_period_ends_at > p_now then 'active_period'
           else 'period_expired' end,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.current_period_ends_at,
      v_subscription.current_period_ends_at is null;
  elsif v_subscription.status = 'cancelled'::public.subscription_status then
    return query select
      v_subscription.current_period_ends_at is not null and v_subscription.current_period_ends_at > p_now,
      case when v_subscription.current_period_ends_at is not null and v_subscription.current_period_ends_at > p_now then 'full' else 'read_only' end,
      case when v_subscription.current_period_ends_at is not null and v_subscription.current_period_ends_at > p_now then 'cancelled_until_period_end' else 'cancelled' end,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.current_period_ends_at, false;
  else
    return query select false, 'read_only'::text, v_subscription.status::text,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.current_period_ends_at, false;
  end if;
end;
$$;

revoke all on function public.resolve_salon_access_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_salon_access_v1(uuid, timestamptz)
  to service_role;

create or replace function public.resolve_employee_capacity_v1(
  p_salon_id uuid,
  p_now timestamptz default now()
)
returns table (
  has_full_access boolean,
  access_reason text,
  effective_plan_id uuid,
  effective_plan_slug text,
  max_employees integer,
  access_source text,
  is_legacy_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.has_full_access, a.access_reason, a.effective_plan_id,
         a.effective_plan_slug, p.max_employees, a.access_source,
         a.is_legacy_active
  from public.resolve_salon_access_v1(p_salon_id, p_now) a
  left join public.plans p on p.id = a.effective_plan_id;
$$;

revoke all on function public.resolve_employee_capacity_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_employee_capacity_v1(uuid, timestamptz)
  to service_role;

alter function public.create_public_booking_atomic(
  text, uuid, uuid, timestamptz, text, text, text, uuid
) rename to create_public_booking_atomic_unchecked_v1;

revoke all on function public.create_public_booking_atomic_unchecked_v1(
  text, uuid, uuid, timestamptz, text, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.create_public_booking_atomic(
  p_salon_slug text,
  p_service_id uuid,
  p_employee_id uuid,
  p_start_time timestamptz,
  p_customer_full_name text,
  p_customer_phone text,
  p_customer_email text,
  p_idempotency_key uuid
)
returns table (
  appointment_id uuid,
  was_created boolean,
  booked_service_name text,
  appointment_start timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salon public.salons%rowtype;
  v_access record;
  v_existing record;
begin
  if p_idempotency_key is not null then
    select a.id, a.salon_id, a.primary_service_id, a.employee_id, a.start_time,
           s.slug, coalesce(aps.service_name_snapshot, sv.name) as service_name
      into v_existing
    from public.appointments a
    join public.salons s on s.id = a.salon_id
    left join public.appointment_services aps
      on aps.appointment_id = a.id and aps.sort_order = 0
    left join public.services sv on sv.id = a.primary_service_id
    where a.idempotency_key = p_idempotency_key
    limit 1;

    if found then
      if v_existing.slug <> p_salon_slug
        or v_existing.primary_service_id <> p_service_id
        or v_existing.employee_id <> p_employee_id
        or v_existing.start_time <> p_start_time then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
      end if;
      return query select v_existing.id, false, v_existing.service_name, v_existing.start_time;
      return;
    end if;
  end if;

  select s.* into v_salon
  from public.salons s
  where s.slug = p_salon_slug
  for key share;

  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLIC_BOOKING_UNAVAILABLE';
  end if;

  perform 1 from public.subscriptions s where s.salon_id = v_salon.id for key share;
  perform 1 from public.billing_access_overrides o where o.salon_id = v_salon.id for key share;

  select * into v_access
  from public.resolve_salon_access_v1(v_salon.id, pg_catalog.now());

  if not coalesce(v_access.has_full_access, false)
    or v_salon.status <> 'active'::public.salon_status
    or not v_salon.booking_enabled
    or not v_salon.online_booking_enabled then
    raise exception using errcode = 'P0001', message = 'PUBLIC_BOOKING_UNAVAILABLE';
  end if;

  return query
  select * from public.create_public_booking_atomic_unchecked_v1(
    p_salon_slug, p_service_id, p_employee_id, p_start_time,
    p_customer_full_name, p_customer_phone, p_customer_email, p_idempotency_key
  );
end;
$$;

revoke all on function public.create_public_booking_atomic(
  text, uuid, uuid, timestamptz, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_public_booking_atomic(
  text, uuid, uuid, timestamptz, text, text, text, uuid
) to service_role;

-- Public booking data is served through subscription-aware server endpoints.
drop policy if exists public_can_read_active_employee_services on public.employee_services;
drop policy if exists public_can_read_active_public_categories on public.service_categories;
drop policy if exists public_can_read_active_public_employees on public.employees;
drop policy if exists public_can_read_active_public_services on public.services;
drop policy if exists public_can_read_closures_for_availability on public.closures;
drop policy if exists public_can_read_working_hours_for_public_booking on public.working_hours;

revoke select on table public.employee_services from anon;
revoke select on table public.service_categories from anon;
revoke select on table public.employees from anon;
revoke select on table public.services from anon;
revoke select on table public.closures from anon;
revoke select on table public.working_hours from anon;

comment on function public.resolve_salon_access_v1(uuid, timestamptz) is
  'Canonical DB subscription/override access resolver. Internal service-role contract.';
comment on function public.create_public_booking_atomic(text, uuid, uuid, timestamptz, text, text, text, uuid) is
  'Creates public bookings only for salons with full access and enabled public booking; successful idempotent replays remain readable.';

commit;

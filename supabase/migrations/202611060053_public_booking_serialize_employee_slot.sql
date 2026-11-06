begin;

-- Public booking: remove the same-slot deadlock by taking a per-employee transaction lock in the gated wrapper
-- before the booking is written. Body otherwise identical to 202607270005; grants unchanged.

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

  -- Serialize bookings for the same employee before any insert. Concurrent overlapping inserts otherwise wait
  -- on each other inside the exclusion constraint check and PostgreSQL aborts one of them with a deadlock (40P01).
  -- With the lock the later request sees the committed booking: the same key replays it (was_created=false) and a
  -- different key fails cleanly on appointments_employee_time_no_overlap (23P01).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public-booking-employee:' || p_employee_id::text, 0)
  );

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

comment on function public.create_public_booking_atomic(text, uuid, uuid, timestamptz, text, text, text, uuid) is
  'Creates confirmed public bookings only for salons with full access and enabled public booking; serialized per employee; successful idempotent replays remain readable.';

commit;

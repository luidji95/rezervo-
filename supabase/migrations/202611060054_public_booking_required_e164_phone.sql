begin;

-- Public booking: phone becomes required and is stored as a normalized E.164 number, and the salon client is linked
-- only by that normalized phone.
-- Why a migration: the gated booking RPC itself looked up the client by an exact phone comparison and then by email,
-- and still accepted a booking with only an email. "064 123 4567" and "+381641234567" were never recognized as one
-- number, and an email could attach a booking to a client with another phone. The route validates first; the
-- database enforces the same rule for any caller. Existing clients are not rewritten, merged or backfilled.

-- Mirror of normalizePhoneToE164 (src/lib/phone/phoneNumber.ts). Returns null for an empty or invalid number.
create or replace function public.normalize_phone_e164_v1(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with cleaned as (
    select pg_catalog.regexp_replace(
      pg_catalog.translate(coalesce(p_phone, ''), pg_catalog.chr(160) || pg_catalog.chr(8239), ''),
      '[[:space:]()./-]', '', 'g') as value
  ), prefixed as (
    select case when value like '00%' then '+' || pg_catalog.substr(value, 3) else value end as value from cleaned
  )
  select case
    when value ~ '^[+]381[0-9]+$' then (
      select case when national ~ '^[1-9][0-9]{7,9}$' then '+381' || national end
      from (select pg_catalog.regexp_replace(pg_catalog.substr(value, 5), '^0', '') as national) serbian
    )
    when value ~ '^[+][1-9][0-9]{7,14}$' then value
    when value ~ '^0[1-9][0-9]{7,9}$' then '+381' || pg_catalog.substr(value, 2)
    else null
  end
  from prefixed
$$;

revoke all on function public.normalize_phone_e164_v1(text) from public, anon, authenticated, service_role;

create or replace function public.create_public_booking_atomic_unchecked_v1(
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
set search_path = public, pg_temp
as $$
declare
  v_salon_id uuid;
  v_service record;
  v_employee_service record;
  v_client_id uuid;
  v_appointment_id uuid;
  v_existing record;
  v_duration_minutes integer;
  v_buffer_minutes integer;
  v_price numeric;
  v_end_time timestamptz;
  v_constraint_name text;
  v_phone text := nullif(btrim(p_customer_phone), '');
  v_email text := nullif(btrim(p_customer_email), '');
  v_match_count integer;
begin
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_customer_full_name, ''))) < 2 then
    raise exception 'Customer name is required.' using errcode = '22023';
  end if;

  -- Phone is required and stored as E.164; email stays optional.
  v_phone := public.normalize_phone_e164_v1(v_phone);
  if v_phone is null then
    raise exception 'A valid phone number is required.' using errcode = '22023';
  end if;

  if p_start_time <= now() then
    raise exception 'Appointment must be in the future.' using errcode = '22023';
  end if;

  select
    appointment.id,
    appointment.salon_id,
    appointment.primary_service_id,
    appointment.employee_id,
    appointment.start_time,
    salon.slug,
    coalesce(snapshot.service_name_snapshot, service.name) as service_name
  into v_existing
  from public.appointments appointment
  join public.salons salon on salon.id = appointment.salon_id
  left join public.appointment_services snapshot
    on snapshot.appointment_id = appointment.id
   and snapshot.sort_order = 0
  left join public.services service
    on service.id = appointment.primary_service_id
  where appointment.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.slug <> p_salon_slug
      or v_existing.primary_service_id <> p_service_id
      or v_existing.employee_id <> p_employee_id
      or v_existing.start_time <> p_start_time
    then
      raise exception 'Idempotency key was reused for another booking.'
        using errcode = '22023';
    end if;

    return query
    select
      v_existing.id,
      false,
      v_existing.service_name,
      v_existing.start_time;
    return;
  end if;

  select salon.id
  into v_salon_id
  from public.salons salon
  where salon.slug = p_salon_slug
    and salon.status = 'active'
    and salon.booking_enabled = true
    and salon.online_booking_enabled = true;

  if v_salon_id is null then
    raise exception 'Public booking is not available.' using errcode = '22023';
  end if;

  select
    service.id,
    service.name,
    service.duration_minutes,
    coalesce(service.buffer_minutes, 0) as buffer_minutes,
    service.price,
    service.currency
  into v_service
  from public.services service
  where service.id = p_service_id
    and service.salon_id = v_salon_id
    and service.is_active = true
    and service.is_public = true;

  if not found then
    raise exception 'Selected service is not available.' using errcode = '22023';
  end if;

  select
    relation.custom_duration_minutes,
    relation.custom_price
  into v_employee_service
  from public.employee_services relation
  join public.employees employee
    on employee.id = relation.employee_id
   and employee.salon_id = v_salon_id
   and employee.is_active = true
   and employee.is_bookable = true
   and employee.is_public = true
  where relation.salon_id = v_salon_id
    and relation.employee_id = p_employee_id
    and relation.service_id = p_service_id
    and relation.is_active = true
  limit 1;

  if not found then
    raise exception 'Selected employee is not available.' using errcode = '22023';
  end if;

  v_duration_minutes := coalesce(
    v_employee_service.custom_duration_minutes,
    v_service.duration_minutes
  );
  v_buffer_minutes := v_service.buffer_minutes;
  v_price := coalesce(v_employee_service.custom_price, v_service.price);
  v_end_time := p_start_time
    + make_interval(mins => v_duration_minutes + v_buffer_minutes);

  begin
    -- The client is found only by the normalized phone within this salon; email is stored but never used to find
    -- a client. All equivalent notations count together (064…, +381 64…, 00381… are one number):
    --   one match   -> that client is used, unchanged;
    --   no match    -> a new client is created with the E.164 number;
    --   several     -> no client is chosen and none is created; the booking is refused with CLIENT_CONTACT_SALON
    --                  and nothing is written. Existing clients are never merged or modified.
    -- The lock serializes bookings of one number in one salon, so concurrent first bookings share one client.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('public-booking-client:' || v_salon_id::text || ':' || v_phone, 0)
    );

    select pg_catalog.count(*), pg_catalog.min(client.id::text)::uuid
    into v_match_count, v_client_id
    from public.clients client
    where client.salon_id = v_salon_id
      and public.normalize_phone_e164_v1(client.phone) = v_phone;

    if v_match_count > 1 then
      raise exception using errcode = 'P0001', message = 'CLIENT_CONTACT_SALON';
    end if;

    if v_client_id is null then
      insert into public.clients (
        salon_id,
        full_name,
        phone,
        email,
        source
      )
      values (
        v_salon_id,
        btrim(p_customer_full_name),
        v_phone,
        v_email,
        'public'
      )
      returning id into v_client_id;
    end if;

    insert into public.appointments (
      salon_id,
      client_id,
      employee_id,
      primary_service_id,
      start_time,
      end_time,
      duration_minutes,
      buffer_minutes,
      price,
      currency,
      status,
      confirmed_at,
      payment_status,
      booking_source,
      idempotency_key
    )
    values (
      v_salon_id,
      v_client_id,
      p_employee_id,
      p_service_id,
      p_start_time,
      v_end_time,
      v_duration_minutes,
      v_buffer_minutes,
      v_price,
      v_service.currency,
      'confirmed',
      now(),
      'unpaid',
      'public',
      p_idempotency_key
    )
    returning id into v_appointment_id;

    insert into public.appointment_services (
      appointment_id,
      service_id,
      service_name_snapshot,
      duration_minutes_snapshot,
      price_snapshot,
      sort_order
    )
    values (
      v_appointment_id,
      p_service_id,
      v_service.name,
      v_duration_minutes,
      v_price,
      0
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name <> 'appointments_idempotency_key_uidx' then
        raise;
      end if;

      select
        appointment.id,
        appointment.salon_id,
        appointment.primary_service_id,
        appointment.employee_id,
        appointment.start_time,
        salon.slug,
        coalesce(snapshot.service_name_snapshot, service.name) as service_name
      into v_existing
      from public.appointments appointment
      join public.salons salon on salon.id = appointment.salon_id
      left join public.appointment_services snapshot
        on snapshot.appointment_id = appointment.id
       and snapshot.sort_order = 0
      left join public.services service
        on service.id = appointment.primary_service_id
      where appointment.idempotency_key = p_idempotency_key
      limit 1;

      if not found then
        raise;
      end if;

      if v_existing.slug <> p_salon_slug
        or v_existing.primary_service_id <> p_service_id
        or v_existing.employee_id <> p_employee_id
        or v_existing.start_time <> p_start_time
      then
        raise exception 'Idempotency key was reused for another booking.'
          using errcode = '22023';
      end if;

      return query
      select
        v_existing.id,
        false,
        v_existing.service_name,
        v_existing.start_time;
      return;
  end;

  return query
  select
    v_appointment_id,
    true,
    v_service.name::text,
    p_start_time;
end;
$$;

revoke all on function public.create_public_booking_atomic_unchecked_v1(
  text, uuid, uuid, timestamptz, text, text, text, uuid
) from public, anon, authenticated, service_role;

commit;

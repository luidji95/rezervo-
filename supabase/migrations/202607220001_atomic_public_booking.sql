create extension if not exists btree_gist;

alter table public.appointments
  add column if not exists idempotency_key uuid;

create unique index if not exists appointments_idempotency_key_uidx
  on public.appointments (idempotency_key)
  where idempotency_key is not null;

do $$
begin
  if exists (
    select 1
    from public.appointments first_appointment
    join public.appointments second_appointment
      on first_appointment.id < second_appointment.id
     and first_appointment.employee_id = second_appointment.employee_id
     and tstzrange(
       first_appointment.start_time,
       first_appointment.end_time,
       '[)'
     ) && tstzrange(
       second_appointment.start_time,
       second_appointment.end_time,
       '[)'
     )
    where first_appointment.status in ('pending', 'confirmed')
      and second_appointment.status in ('pending', 'confirmed')
  ) then
    raise exception
      'Cannot add appointment overlap constraint: blocking overlaps exist.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_employee_time_no_overlap'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_employee_time_no_overlap
      exclude using gist (
        employee_id with =,
        tstzrange(start_time, end_time, '[)') with &&
      )
      where (
        employee_id is not null
        and status in ('pending', 'confirmed')
      );
  end if;
end;
$$;

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
begin
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_customer_full_name, ''))) < 2 then
    raise exception 'Customer name is required.' using errcode = '22023';
  end if;

  if v_phone is null and v_email is null then
    raise exception 'Phone or email is required.' using errcode = '22023';
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
    if v_phone is not null then
      select client.id
      into v_client_id
      from public.clients client
      where client.salon_id = v_salon_id
        and client.phone = v_phone
      limit 1;
    end if;

    if v_client_id is null and v_email is not null then
      select client.id
      into v_client_id
      from public.clients client
      where client.salon_id = v_salon_id
        and client.email = v_email
      limit 1;
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
      'pending',
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

revoke all on function public.create_public_booking_atomic(
  text,
  uuid,
  uuid,
  timestamptz,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_public_booking_atomic(
  text,
  uuid,
  uuid,
  timestamptz,
  text,
  text,
  text,
  uuid
) to service_role;

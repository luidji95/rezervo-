create or replace function public.create_employee_appointment_atomic(
  p_profile_id uuid,
  p_service_id uuid,
  p_start_time timestamp with time zone,
  p_customer_full_name text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_note text,
  p_idempotency_key uuid
)
returns table (
  appointment_id uuid,
  was_created boolean,
  appointment_status public.appointment_status,
  appointment_start timestamp with time zone,
  salon_id uuid,
  service_name text,
  customer_name text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_context record;
  v_existing record;
  v_client_id uuid;
  v_client_by_phone uuid;
  v_client_by_email uuid;
  v_appointment_id uuid;
  v_duration integer;
  v_buffer integer;
  v_price numeric;
  v_end_time timestamp with time zone;
  v_phone text := nullif(regexp_replace(btrim(p_customer_phone), '[[:space:]()-]', '', 'g'), '');
  v_email text := nullif(lower(btrim(p_customer_email)), '');
  v_name text := btrim(coalesce(p_customer_full_name, ''));
  v_note text := nullif(btrim(p_customer_note), '');
  v_constraint_name text;
begin
  if p_profile_id is null or p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  if length(v_name) < 2 or (v_phone is null and v_email is null) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  if p_start_time <= now() then
    raise exception 'SLOT_UNAVAILABLE' using errcode = '22023';
  end if;

  select
    salon.id as salon_id,
    employee.id as employee_id,
    service.id as service_id,
    service.name as service_name,
    service.duration_minutes,
    coalesce(service.buffer_minutes, 0) as buffer_minutes,
    service.price,
    service.currency,
    relation.custom_duration_minutes,
    relation.custom_price
  into v_context
  from public.salon_members as membership
  join public.salons as salon
    on salon.id = membership.salon_id
   and salon.status = 'active'::public.salon_status
  join public.employees as employee
    on employee.salon_id = membership.salon_id
   and employee.profile_id = membership.profile_id
   and employee.is_active = true
   and employee.is_bookable = true
  join public.employee_services as relation
    on relation.salon_id = employee.salon_id
   and relation.employee_id = employee.id
   and relation.service_id = p_service_id
   and relation.is_active = true
  join public.services as service
    on service.id = relation.service_id
   and service.salon_id = employee.salon_id
   and service.is_active = true
  where membership.profile_id = p_profile_id
    and membership.role = 'employee'::public.salon_member_role
    and membership.status = 'active'::public.member_status
  limit 1;

  if not found then
    raise exception 'SERVICE_NOT_ASSIGNED' using errcode = 'P0001';
  end if;

  v_duration := coalesce(v_context.custom_duration_minutes, v_context.duration_minutes);
  v_buffer := v_context.buffer_minutes;
  v_price := coalesce(v_context.custom_price, v_context.price);
  v_end_time := p_start_time + make_interval(mins => v_duration + v_buffer);

  perform pg_advisory_xact_lock(
    hashtextextended('employee-appointment:' || p_idempotency_key::text, 0)
  );

  select
    appointment.id,
    appointment.salon_id,
    appointment.employee_id,
    appointment.primary_service_id,
    appointment.start_time,
    appointment.status
  into v_existing
  from public.appointments as appointment
  where appointment.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.salon_id <> v_context.salon_id
      or v_existing.employee_id is distinct from v_context.employee_id
      or v_existing.primary_service_id is distinct from p_service_id
      or v_existing.start_time <> p_start_time
    then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    return query select
      v_existing.id,
      false,
      v_existing.status,
      v_existing.start_time,
      v_existing.salon_id,
      v_context.service_name::text,
      v_name;
    return;
  end if;

  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_context.salon_id::text || ':phone:' || v_phone, 0));
  end if;
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_context.salon_id::text || ':email:' || v_email, 0));
  end if;

  if v_phone is not null then
    select client.id into v_client_by_phone
    from public.clients as client
    where client.salon_id = v_context.salon_id
      and regexp_replace(btrim(coalesce(client.phone, '')), '[[:space:]()-]', '', 'g') = v_phone
    order by client.created_at
    limit 1;
  end if;

  if v_email is not null then
    select client.id into v_client_by_email
    from public.clients as client
    where client.salon_id = v_context.salon_id
      and lower(btrim(coalesce(client.email, ''))) = v_email
    order by client.created_at
    limit 1;
  end if;

  if v_client_by_phone is not null
    and v_client_by_email is not null
    and v_client_by_phone <> v_client_by_email
  then
    raise exception 'CLIENT_CONFLICT' using errcode = 'P0001';
  end if;

  v_client_id := coalesce(v_client_by_phone, v_client_by_email);
  if v_client_id is null then
    insert into public.clients (salon_id, full_name, phone, email, source)
    values (v_context.salon_id, v_name, v_phone, v_email, 'manual')
    returning id into v_client_id;
  end if;

  begin
    insert into public.appointments (
      salon_id, client_id, employee_id, primary_service_id,
      start_time, end_time, duration_minutes, buffer_minutes,
      price, currency, status, payment_status, booking_source,
      customer_note, idempotency_key
    ) values (
      v_context.salon_id, v_client_id, v_context.employee_id, p_service_id,
      p_start_time, v_end_time, v_duration, v_buffer,
      v_price, v_context.currency, 'pending', 'unpaid', 'manual',
      v_note, p_idempotency_key
    ) returning id into v_appointment_id;

    insert into public.appointment_services (
      appointment_id, service_id, service_name_snapshot,
      duration_minutes_snapshot, price_snapshot, sort_order
    ) values (
      v_appointment_id, p_service_id, v_context.service_name,
      v_duration, v_price, 0
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'appointments_idempotency_key_uidx' then
        raise;
      end if;

      select appointment.id, appointment.salon_id, appointment.employee_id,
        appointment.primary_service_id, appointment.start_time, appointment.status
      into v_existing
      from public.appointments as appointment
      where appointment.idempotency_key = p_idempotency_key
      limit 1;

      if not found
        or v_existing.salon_id <> v_context.salon_id
        or v_existing.employee_id is distinct from v_context.employee_id
        or v_existing.primary_service_id is distinct from p_service_id
        or v_existing.start_time <> p_start_time
      then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
      end if;

      return query select v_existing.id, false, v_existing.status,
        v_existing.start_time, v_existing.salon_id,
        v_context.service_name::text, v_name;
      return;
  end;

  return query select v_appointment_id, true,
    'pending'::public.appointment_status, p_start_time,
    v_context.salon_id, v_context.service_name::text, v_name;
end;
$$;

revoke all on function public.create_employee_appointment_atomic(
  uuid, uuid, timestamp with time zone, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.create_employee_appointment_atomic(
  uuid, uuid, timestamp with time zone, text, text, text, text, uuid
) to service_role;

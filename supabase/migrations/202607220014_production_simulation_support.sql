create or replace function public.get_simulation_schema_contract()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with audit as (
    select
      exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and tablename = 'employee_services'
          and indexname = 'employee_services_unique_pair'
          and indexdef ilike '%unique%employee_id%service_id%'
      ) as employee_service_unique,
      exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and tablename = 'appointments'
          and indexname = 'appointments_idempotency_key_uidx'
          and indexdef ilike '%unique%idempotency_key%'
      ) as appointment_idempotency_unique,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointments'::pg_catalog.regclass
          and conname = 'appointments_employee_time_no_overlap'
          and contype = 'x'
      ) as appointment_overlap_exclusion,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_appointment_id_fkey'
          and contype = 'f'
      ) as snapshot_appointment_fk,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_service_id_fkey'
          and contype = 'f'
      ) as snapshot_service_fk,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_duration_positive'
          and contype = 'c'
      ) as snapshot_duration_check,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_price_non_negative'
          and contype = 'c'
      ) as snapshot_price_check
  )
  select jsonb_build_object(
    'ready',
      employee_service_unique
      and appointment_idempotency_unique
      and appointment_overlap_exclusion
      and snapshot_appointment_fk
      and snapshot_service_fk
      and snapshot_duration_check
      and snapshot_price_check,
    'guards', jsonb_build_object(
      'employeeServiceUnique', employee_service_unique,
      'appointmentIdempotencyUnique', appointment_idempotency_unique,
      'appointmentOverlapExclusion', appointment_overlap_exclusion,
      'snapshotAppointmentFk', snapshot_appointment_fk,
      'snapshotServiceFk', snapshot_service_fk,
      'snapshotDurationCheck', snapshot_duration_check,
      'snapshotPriceCheck', snapshot_price_check
    )
  )
  from audit;
$$;

revoke all on function public.get_simulation_schema_contract()
  from public, anon, authenticated;
grant execute on function public.get_simulation_schema_contract()
  to service_role;

create or replace function public.insert_simulation_client_batch(
  p_salon_id uuid,
  p_clients jsonb
)
returns table (inserted_count integer, existing_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item jsonb;
  v_existing public.clients%rowtype;
  v_id uuid;
  v_name text;
  v_phone text;
  v_email text;
  v_source text;
  v_created_at timestamptz;
begin
  inserted_count := 0;
  existing_count := 0;

  if p_salon_id is null
    or jsonb_typeof(p_clients) <> 'array'
    or jsonb_array_length(p_clients) < 1
    or jsonb_array_length(p_clients) > 500
    or not exists (select 1 from public.salons where id = p_salon_id)
  then
    raise exception 'INVALID_SIMULATION_CLIENT_BATCH' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_clients)
  loop
    v_id := (v_item ->> 'id')::uuid;
    v_name := btrim(coalesce(v_item ->> 'full_name', ''));
    v_phone := nullif(regexp_replace(btrim(v_item ->> 'phone'), '[[:space:]()-]', '', 'g'), '');
    v_email := nullif(lower(btrim(v_item ->> 'email')), '');
    v_source := coalesce(nullif(btrim(v_item ->> 'source'), ''), 'manual');
    v_created_at := (v_item ->> 'created_at')::timestamptz;

    if length(v_name) < 2 or (v_phone is null and v_email is null) then
      raise exception 'INVALID_SIMULATION_CLIENT' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.clients as client
      where client.salon_id = p_salon_id
        and client.id <> v_id
        and (
          (v_phone is not null and regexp_replace(btrim(coalesce(client.phone, '')), '[[:space:]()-]', '', 'g') = v_phone)
          or (v_email is not null and lower(btrim(coalesce(client.email, ''))) = v_email)
        )
    ) then
      raise exception 'SIMULATION_CLIENT_CONTACT_CONFLICT' using errcode = 'P0001';
    end if;

    select * into v_existing
    from public.clients
    where id = v_id;

    if found then
      if v_existing.salon_id <> p_salon_id
        or v_existing.full_name <> v_name
        or v_existing.phone is distinct from v_phone
        or v_existing.email is distinct from v_email
      then
        raise exception 'SIMULATION_CLIENT_ID_CONFLICT' using errcode = 'P0001';
      end if;
      existing_count := existing_count + 1;
    else
      insert into public.clients (
        id, salon_id, full_name, phone, email, source, status, created_at
      ) values (
        v_id, p_salon_id, v_name, v_phone, v_email, v_source,
        'active'::public.client_status, v_created_at
      );
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return next;
end;
$$;

revoke all on function public.insert_simulation_client_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_simulation_client_batch(uuid, jsonb)
  to service_role;

create or replace function public.insert_simulation_appointment_batch(
  p_salon_id uuid,
  p_appointments jsonb
)
returns table (inserted_count integer, existing_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item jsonb;
  v_existing public.appointments%rowtype;
  v_context record;
  v_schedule record;
  v_id uuid;
  v_snapshot_id uuid;
  v_client_id uuid;
  v_employee_id uuid;
  v_service_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_duration integer;
  v_buffer integer;
  v_price numeric;
  v_status public.appointment_status;
  v_source public.booking_source;
  v_idempotency_key uuid;
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  inserted_count := 0;
  existing_count := 0;

  if p_salon_id is null
    or jsonb_typeof(p_appointments) <> 'array'
    or jsonb_array_length(p_appointments) < 1
    or jsonb_array_length(p_appointments) > 500
  then
    raise exception 'INVALID_SIMULATION_APPOINTMENT_BATCH' using errcode = '22023';
  end if;

  select coalesce(nullif(timezone, ''), 'Europe/Belgrade')
    into v_timezone
  from public.salons
  where id = p_salon_id;
  if not found then
    raise exception 'SIMULATION_SALON_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_appointments)
  loop
    v_id := (v_item ->> 'id')::uuid;
    v_snapshot_id := (v_item ->> 'snapshot_id')::uuid;
    v_client_id := (v_item ->> 'client_id')::uuid;
    v_employee_id := (v_item ->> 'employee_id')::uuid;
    v_service_id := (v_item ->> 'service_id')::uuid;
    v_start := (v_item ->> 'start_time')::timestamptz;
    v_end := (v_item ->> 'end_time')::timestamptz;
    v_duration := (v_item ->> 'duration_minutes')::integer;
    v_buffer := (v_item ->> 'buffer_minutes')::integer;
    v_price := (v_item ->> 'price')::numeric;
    v_status := (v_item ->> 'status')::public.appointment_status;
    v_source := (v_item ->> 'booking_source')::public.booking_source;
    v_idempotency_key := (v_item ->> 'idempotency_key')::uuid;

    if v_status not in (
      'completed'::public.appointment_status,
      'cancelled'::public.appointment_status,
      'no_show'::public.appointment_status
    ) or v_start >= now() or v_end <= v_start then
      raise exception 'INVALID_SIMULATION_APPOINTMENT' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.clients
      where id = v_client_id and salon_id = p_salon_id
    ) then
      raise exception 'SIMULATION_CLIENT_NOT_FOUND' using errcode = 'P0001';
    end if;

    select
      employee.id as employee_id,
      service.id as service_id,
      service.name as service_name,
      coalesce(relation.custom_duration_minutes, service.duration_minutes) as duration_minutes,
      coalesce(service.buffer_minutes, 0) as buffer_minutes,
      coalesce(relation.custom_price, service.price) as price
    into v_context
    from public.employees as employee
    join public.employee_services as relation
      on relation.salon_id = employee.salon_id
     and relation.employee_id = employee.id
     and relation.service_id = v_service_id
     and relation.is_active = true
    join public.services as service
      on service.id = relation.service_id
     and service.salon_id = employee.salon_id
     and service.is_active = true
    where employee.id = v_employee_id
      and employee.salon_id = p_salon_id
      and employee.is_active = true;

    if not found
      or v_duration <> v_context.duration_minutes
      or v_buffer <> v_context.buffer_minutes
      or v_price <> v_context.price
      or v_end <> v_start + make_interval(mins => v_duration + v_buffer)
      or (v_item ->> 'service_name_snapshot') <> v_context.service_name
    then
      raise exception 'SIMULATION_SERVICE_ASSIGNMENT_MISMATCH' using errcode = 'P0001';
    end if;

    v_local_start := timezone(v_timezone, v_start);
    v_local_end := timezone(v_timezone, v_end);
    select working.* into v_schedule
    from public.working_hours as working
    where working.salon_id = p_salon_id
      and working.day_of_week = extract(dow from v_local_start)::integer
      and (working.employee_id = v_employee_id or working.employee_id is null)
    order by (working.employee_id is null)
    limit 1;

    if not found
      or not v_schedule.is_working_day
      or v_local_start::date <> v_local_end::date
      or v_local_start::time < v_schedule.opens_at
      or v_local_end::time > v_schedule.closes_at
      or (
        v_schedule.break_starts_at is not null
        and v_schedule.break_ends_at is not null
        and v_local_start::time < v_schedule.break_ends_at
        and v_local_end::time > v_schedule.break_starts_at
      )
    then
      raise exception 'SIMULATION_OUTSIDE_WORKING_HOURS' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from public.closures as closure
      where closure.salon_id = p_salon_id
        and (closure.employee_id is null or closure.employee_id = v_employee_id)
        and tstzrange(closure.starts_at, closure.ends_at, '[)') && tstzrange(v_start, v_end, '[)')
    ) then
      raise exception 'SIMULATION_CLOSURE_CONFLICT' using errcode = 'P0001';
    end if;

    select * into v_existing from public.appointments where id = v_id;
    if found then
      if v_existing.salon_id <> p_salon_id
        or v_existing.client_id is distinct from v_client_id
        or v_existing.employee_id is distinct from v_employee_id
        or v_existing.primary_service_id is distinct from v_service_id
        or v_existing.start_time <> v_start
        or v_existing.end_time <> v_end
        or v_existing.duration_minutes <> v_duration
        or v_existing.buffer_minutes <> v_buffer
        or v_existing.price <> v_price
        or v_existing.status <> v_status
        or v_existing.booking_source <> v_source
        or v_existing.idempotency_key is distinct from v_idempotency_key
        or not exists (
          select 1 from public.appointment_services
          where id = v_snapshot_id
            and appointment_id = v_id
            and service_id = v_service_id
            and service_name_snapshot = v_context.service_name
            and duration_minutes_snapshot = v_duration
            and price_snapshot = v_price
            and sort_order = 0
        )
      then
        raise exception 'SIMULATION_APPOINTMENT_ID_CONFLICT' using errcode = 'P0001';
      end if;
      existing_count := existing_count + 1;
      continue;
    end if;

    if exists (
      select 1 from public.appointments as appointment
      where appointment.employee_id = v_employee_id
        and appointment.id <> v_id
        and tstzrange(appointment.start_time, appointment.end_time, '[)') && tstzrange(v_start, v_end, '[)')
    ) then
      raise exception 'SIMULATION_APPOINTMENT_OVERLAP' using errcode = '23P01';
    end if;

    insert into public.appointments (
      id, salon_id, client_id, employee_id, primary_service_id,
      start_time, end_time, duration_minutes, buffer_minutes,
      price, currency, status, payment_status, booking_source,
      cancellation_reason, cancelled_at, cancelled_by,
      confirmed_at, completed_at, created_at, idempotency_key
    ) values (
      v_id, p_salon_id, v_client_id, v_employee_id, v_service_id,
      v_start, v_end, v_duration, v_buffer,
      v_price, (v_item ->> 'currency'), v_status, 'unpaid'::public.payment_status, v_source,
      nullif(v_item ->> 'cancellation_reason', ''),
      nullif(v_item ->> 'cancelled_at', '')::timestamptz,
      nullif(v_item ->> 'cancelled_by', ''),
      nullif(v_item ->> 'confirmed_at', '')::timestamptz,
      nullif(v_item ->> 'completed_at', '')::timestamptz,
      (v_item ->> 'created_at')::timestamptz,
      v_idempotency_key
    );

    insert into public.appointment_services (
      id, appointment_id, service_id, service_name_snapshot,
      duration_minutes_snapshot, price_snapshot, sort_order,
      created_at
    ) values (
      v_snapshot_id, v_id, v_service_id, v_context.service_name,
      v_duration, v_price, 0,
      (v_item ->> 'created_at')::timestamptz
    );
    inserted_count := inserted_count + 1;
  end loop;

  return next;
end;
$$;

revoke all on function public.insert_simulation_appointment_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_simulation_appointment_batch(uuid, jsonb)
  to service_role;

create or replace function public.cleanup_simulation_run(
  p_salon_id uuid,
  p_appointment_ids uuid[],
  p_client_ids uuid[]
)
returns table (
  deleted_notifications integer,
  deleted_snapshots integer,
  deleted_appointments integer,
  deleted_clients integer,
  retained_clients integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_salon_id is null or p_appointment_ids is null or p_client_ids is null then
    raise exception 'INVALID_SIMULATION_CLEANUP' using errcode = '22023';
  end if;

  delete from public.notifications
  where salon_id = p_salon_id
    and entity_type = 'appointment'
    and entity_id::text = any(p_appointment_ids::text[]);
  get diagnostics deleted_notifications = row_count;

  delete from public.appointment_services as snapshot
  using public.appointments as appointment
  where snapshot.appointment_id = appointment.id
    and appointment.salon_id = p_salon_id
    and appointment.id = any(p_appointment_ids);
  get diagnostics deleted_snapshots = row_count;

  delete from public.appointments
  where salon_id = p_salon_id
    and id = any(p_appointment_ids);
  get diagnostics deleted_appointments = row_count;

  delete from public.clients as client
  where client.salon_id = p_salon_id
    and client.id = any(p_client_ids)
    and not exists (
      select 1 from public.appointments as appointment
      where appointment.client_id = client.id
    );
  get diagnostics deleted_clients = row_count;

  select count(*)::integer into retained_clients
  from public.clients as client
  where client.salon_id = p_salon_id
    and client.id = any(p_client_ids);

  return next;
end;
$$;

revoke all on function public.cleanup_simulation_run(uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.cleanup_simulation_run(uuid, uuid[], uuid[])
  to service_role;

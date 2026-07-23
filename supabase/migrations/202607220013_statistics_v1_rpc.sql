create or replace function public.get_owner_statistics_v1(
  p_salon_id uuid,
  p_start_utc timestamp with time zone,
  p_end_utc timestamp with time zone,
  p_granularity text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_timezone text;
  v_currency text;
  v_result jsonb;
begin
  if p_salon_id is null
    or p_start_utc is null
    or p_end_utc is null
    or p_start_utc >= p_end_utc
    or p_granularity not in ('day', 'month')
  then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;

  select
    coalesce(nullif(salon.timezone, ''), 'Europe/Belgrade'),
    coalesce(nullif(salon.default_currency, ''), 'RSD')
  into v_timezone, v_currency
  from public.salons as salon
  where salon.id = p_salon_id;

  if not found then
    raise exception 'SALON_NOT_FOUND' using errcode = 'P0001';
  end if;

  with
  period_appointments as materialized (
    select appointment.*
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.start_time >= p_start_utc
      and appointment.start_time < p_end_utc
  ),
  completed_history as materialized (
    select
      appointment.id,
      appointment.client_id,
      appointment.start_time,
      row_number() over (
        partition by appointment.client_id
        order by appointment.start_time, appointment.id
      ) as completed_ordinal
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.client_id is not null
      and appointment.start_time < p_end_utc
  ),
  overview_values as (
    select
      coalesce(sum(appointment.price) filter (
        where appointment.status = 'completed'::public.appointment_status
      ), 0) as completed_revenue,
      count(*) filter (
        where appointment.status = 'completed'::public.appointment_status
      ) as completed_appointments,
      count(*) filter (
        where appointment.status = 'no_show'::public.appointment_status
      ) as no_show_appointments
    from period_appointments as appointment
  ),
  client_values as (
    select
      count(distinct history.client_id) filter (
        where history.completed_ordinal = 1
          and history.start_time >= p_start_utc
          and history.start_time < p_end_utc
      ) as new_clients,
      count(distinct history.client_id) filter (
        where history.completed_ordinal >= 2
      ) as returning_clients,
      count(*) filter (
        where history.completed_ordinal >= 2
          and history.start_time >= p_start_utc
          and history.start_time < p_end_utc
      ) as returning_visits
    from completed_history as history
  ),
  trend_rows as (
    select
      case
        when p_granularity = 'month' then
          to_char(date_trunc('month', timezone(v_timezone, appointment.start_time)), 'YYYY-MM')
        else
          to_char(date_trunc('day', timezone(v_timezone, appointment.start_time)), 'YYYY-MM-DD')
      end as bucket,
      coalesce(sum(appointment.price), 0) as revenue,
      count(*) as completed_appointments
    from period_appointments as appointment
    where appointment.status = 'completed'::public.appointment_status
    group by 1
    order by 1
  ),
  source_rows as (
    select
      coalesce(appointment.booking_source::text, 'unknown') as source,
      count(*) as source_count
    from period_appointments as appointment
    group by 1
    order by source_count desc, source
  ),
  service_rows as (
    select
      coalesce(snapshot.service_id::text, 'snapshot:' || lower(snapshot.service_name_snapshot)) as service_key,
      (array_agg(
        snapshot.service_name_snapshot
        order by appointment.start_time desc, snapshot.sort_order, snapshot.id
      ))[1] as service_name,
      count(*) as completed_count,
      coalesce(sum(snapshot.price_snapshot), 0) as revenue
    from period_appointments as appointment
    join public.appointment_services as snapshot
      on snapshot.appointment_id = appointment.id
    where appointment.status = 'completed'::public.appointment_status
    group by 1
    order by revenue desc, completed_count desc, service_name
    limit 10
  ),
  employee_rows as (
    select
      appointment.employee_id,
      coalesce(employee.display_name, employee.full_name, 'Nepoznat zaposleni') as employee_name,
      count(*) filter (where appointment.status = 'completed'::public.appointment_status) as completed,
      count(*) filter (where appointment.status = 'confirmed'::public.appointment_status) as confirmed,
      count(*) filter (where appointment.status = 'cancelled'::public.appointment_status) as cancelled,
      count(*) filter (where appointment.status = 'no_show'::public.appointment_status) as no_show,
      coalesce(sum(appointment.price) filter (
        where appointment.status = 'completed'::public.appointment_status
      ), 0) as revenue
    from period_appointments as appointment
    left join public.employees as employee
      on employee.id = appointment.employee_id
     and employee.salon_id = p_salon_id
    group by appointment.employee_id, employee.display_name, employee.full_name
    order by revenue desc, completed desc, employee_name
  ),
  top_client_rows as (
    select
      appointment.client_id,
      coalesce(client.full_name, 'Nepoznat klijent') as client_name,
      count(*) as completed_visits,
      coalesce(sum(appointment.price), 0) as revenue
    from period_appointments as appointment
    left join public.clients as client
      on client.id = appointment.client_id
     and client.salon_id = p_salon_id
    where appointment.status = 'completed'::public.appointment_status
    group by appointment.client_id, client.full_name
    order by revenue desc, completed_visits desc, client_name
    limit 10
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'completedRevenue', overview.completed_revenue,
      'completedAppointments', overview.completed_appointments,
      'newClients', clients.new_clients,
      'returningClients', clients.returning_clients,
      'returningVisits', clients.returning_visits,
      'noShowRate', case
        when overview.completed_appointments + overview.no_show_appointments = 0 then 0
        else round(
          overview.no_show_appointments::numeric * 100 /
          (overview.completed_appointments + overview.no_show_appointments),
          2
        )
      end,
      'currency', v_currency
    ),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket', trend.bucket,
        'revenue', trend.revenue,
        'completedAppointments', trend.completed_appointments
      ) order by trend.bucket)
      from trend_rows as trend
    ), '[]'::jsonb),
    'appointments', jsonb_build_object(
      'total', (select count(*) from period_appointments),
      'byStatus', jsonb_build_object(
        'pending', (select count(*) from period_appointments where status = 'pending'::public.appointment_status),
        'confirmed', (select count(*) from period_appointments where status = 'confirmed'::public.appointment_status),
        'completed', (select count(*) from period_appointments where status = 'completed'::public.appointment_status),
        'cancelled', (select count(*) from period_appointments where status = 'cancelled'::public.appointment_status),
        'no_show', (select count(*) from period_appointments where status = 'no_show'::public.appointment_status)
      ),
      'bySource', coalesce((
        select jsonb_agg(jsonb_build_object(
          'source', source.source,
          'count', source.source_count
        ) order by source.source_count desc, source.source)
        from source_rows as source
      ), '[]'::jsonb)
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'serviceKey', service.service_key,
        'serviceName', service.service_name,
        'completedCount', service.completed_count,
        'revenue', service.revenue
      ) order by service.revenue desc, service.completed_count desc)
      from service_rows as service
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeId', employee.employee_id,
        'employeeName', employee.employee_name,
        'completed', employee.completed,
        'confirmed', employee.confirmed,
        'cancelled', employee.cancelled,
        'noShow', employee.no_show,
        'revenue', employee.revenue
      ) order by employee.revenue desc, employee.completed desc)
      from employee_rows as employee
    ), '[]'::jsonb),
    'clients', jsonb_build_object(
      'topClients', coalesce((
        select jsonb_agg(jsonb_build_object(
          'clientId', client.client_id,
          'clientName', client.client_name,
          'completedVisits', client.completed_visits,
          'revenue', client.revenue
        ) order by client.revenue desc, client.completed_visits desc)
        from top_client_rows as client
      ), '[]'::jsonb)
    )
  )
  into v_result
  from overview_values as overview
  cross join client_values as clients;

  return v_result;
end;
$$;

revoke all on function public.get_owner_statistics_v1(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text
) from public, anon, authenticated;

grant execute on function public.get_owner_statistics_v1(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text
) to service_role;

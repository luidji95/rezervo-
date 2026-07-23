create or replace function public.get_owner_clients_page_v1(
  p_salon_id uuid,
  p_page integer,
  p_page_size integer,
  p_search text,
  p_status text,
  p_sort text,
  p_month_start_utc timestamptz,
  p_month_end_utc timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offset integer;
  v_result jsonb;
begin
  if p_salon_id is null
    or p_page < 1
    or p_page_size < 1
    or p_page_size > 100
    or p_sort not in ('newest', 'oldest', 'name_asc', 'name_desc', 'most_visits', 'highest_spend')
    or p_status not in ('all', 'active', 'blocked', 'archived')
    or p_month_start_utc is null
    or p_month_end_utc is null
    or p_month_start_utc >= p_month_end_utc
  then
    raise exception 'INVALID_CLIENTS_QUERY' using errcode = '22023';
  end if;

  if not exists (select 1 from public.salons where id = p_salon_id) then
    raise exception 'SALON_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_offset := (p_page - 1) * p_page_size;

  with completed_metrics as (
    select
      appointment.client_id,
      count(*)::integer as completed_visits,
      coalesce(sum(appointment.price), 0)::numeric as completed_revenue,
      max(appointment.start_time) as last_completed_visit
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.client_id is not null
    group by appointment.client_id
  ),
  favorite_service_counts as (
    select
      appointment.client_id,
      snapshot.service_id,
      snapshot.service_name_snapshot,
      count(*)::integer as completed_count,
      row_number() over (
        partition by appointment.client_id
        order by count(*) desc, snapshot.service_name_snapshot, snapshot.service_id
      ) as rank
    from public.appointments as appointment
    join public.appointment_services as snapshot
      on snapshot.appointment_id = appointment.id
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.client_id is not null
    group by appointment.client_id, snapshot.service_id, snapshot.service_name_snapshot
  ),
  filtered_clients as (
    select
      client.id,
      client.salon_id,
      client.full_name,
      client.phone,
      client.email,
      client.status::text as status,
      client.source,
      client.created_at,
      coalesce(metric.completed_visits, 0) as completed_visits,
      coalesce(metric.completed_revenue, 0) as completed_revenue,
      metric.last_completed_visit,
      favorite.service_id as favorite_service_id,
      favorite.service_name_snapshot as favorite_service_name,
      favorite.completed_count as favorite_service_count
    from public.clients as client
    left join completed_metrics as metric on metric.client_id = client.id
    left join favorite_service_counts as favorite
      on favorite.client_id = client.id
     and favorite.rank = 1
    where client.salon_id = p_salon_id
      and (p_status = 'all' or client.status::text = p_status)
      and (
        nullif(btrim(p_search), '') is null
        or client.full_name ilike '%' || btrim(p_search) || '%'
        or coalesce(client.phone, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(client.email, '') ilike '%' || btrim(p_search) || '%'
      )
  ),
  page_rows as (
    select *
    from filtered_clients
    order by
      case when p_sort = 'newest' then created_at end desc nulls last,
      case when p_sort = 'oldest' then created_at end asc nulls last,
      case when p_sort = 'name_asc' then lower(full_name) end asc nulls last,
      case when p_sort = 'name_desc' then lower(full_name) end desc nulls last,
      case when p_sort = 'most_visits' then completed_visits end desc nulls last,
      case when p_sort = 'highest_spend' then completed_revenue end desc nulls last,
      id
    offset v_offset
    limit p_page_size
  ),
  month_completed as (
    select appointment.client_id, appointment.price
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.start_time >= p_month_start_utc
      and appointment.start_time < p_month_end_utc
  ),
  salon_client_metrics as (
    select count(*)::integer as clients_with_visits,
           count(*) filter (where completed_visits >= 2)::integer as returning_clients
    from completed_metrics
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', client.id,
        'salonId', client.salon_id,
        'fullName', client.full_name,
        'phone', client.phone,
        'email', client.email,
        'status', client.status,
        'source', client.source,
        'createdAt', client.created_at,
        'completedVisits', client.completed_visits,
        'completedRevenue', client.completed_revenue,
        'lastCompletedVisit', client.last_completed_visit,
        'favoriteService', case when client.favorite_service_name is null then null else jsonb_build_object(
          'serviceId', client.favorite_service_id,
          'name', client.favorite_service_name,
          'count', client.favorite_service_count
        ) end,
        'recentVisits', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', visit.id,
            'startTime', visit.start_time,
            'serviceName', visit.service_name,
            'price', visit.price
          ) order by visit.start_time desc)
          from (
            select appointment.id, appointment.start_time,
                   coalesce(snapshot.service_name_snapshot, service.name, 'Bez usluge') as service_name,
                   coalesce(appointment.price, 0) as price
            from public.appointments as appointment
            left join public.appointment_services as snapshot
              on snapshot.appointment_id = appointment.id and snapshot.sort_order = 0
            left join public.services as service on service.id = appointment.primary_service_id
            where appointment.salon_id = p_salon_id
              and appointment.client_id = client.id
              and appointment.status = 'completed'::public.appointment_status
            order by appointment.start_time desc
            limit 5
          ) as visit
        ), '[]'::jsonb)
      )) from page_rows as client
    ), '[]'::jsonb),
    'page', p_page,
    'pageSize', p_page_size,
    'totalCount', (select count(*) from filtered_clients),
    'kpis', jsonb_build_object(
      'totalClients', (select count(*) from public.clients where salon_id = p_salon_id),
      'newClientsThisMonth', (select count(*) from public.clients where salon_id = p_salon_id and created_at >= p_month_start_utc and created_at < p_month_end_utc),
      'visitsThisMonth', (select count(*) from month_completed),
      'revenueThisMonth', (select coalesce(sum(price), 0) from month_completed),
      'clientsWithVisits', (select clients_with_visits from salon_client_metrics),
      'returningClients', (select returning_clients from salon_client_metrics)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_owner_clients_page_v1(uuid, integer, integer, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_owner_clients_page_v1(uuid, integer, integer, text, text, text, timestamptz, timestamptz) to service_role;

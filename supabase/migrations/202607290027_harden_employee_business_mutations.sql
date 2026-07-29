begin;

create or replace function public.update_employee_details_v1(
  p_employee_id uuid, p_full_name text, p_display_name text,
  p_position text, p_phone text, p_email text, p_bio text,
  p_is_bookable boolean, p_is_public boolean
)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_access record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  select e.* into v_employee
  from public.employees e
  where e.id = p_employee_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if not public.is_salon_owner_or_manager(v_employee.salon_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_access
  from public.resolve_salon_access_v1(v_employee.salon_id, pg_catalog.now());

  if not coalesce(v_access.has_full_access, false) then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_ACCESS_REQUIRED';
  end if;

  if p_full_name is null
     or length(btrim(p_full_name)) < 1
     or length(btrim(p_full_name)) > 200
     or (p_email is not null and length(btrim(p_email)) > 320)
     or (p_bio is not null and length(p_bio) > 5000) then
    raise exception using errcode = '22023', message = 'INVALID_EMPLOYEE';
  end if;

  update public.employees e set
    full_name = btrim(p_full_name),
    display_name = nullif(btrim(p_display_name), ''),
    position = nullif(btrim(p_position), ''),
    phone = nullif(btrim(p_phone), ''),
    email = nullif(btrim(p_email), ''),
    bio = nullif(btrim(p_bio), ''),
    is_bookable = coalesce(p_is_bookable, e.is_bookable),
    is_public = coalesce(p_is_public, e.is_public)
  where e.id = p_employee_id
  returning e.* into v_employee;

  return v_employee;
end;
$$;

create or replace function public.set_employee_active_state(
  p_employee_id uuid, p_is_active boolean
)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_access record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  select e.* into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if not public.is_salon_owner_or_manager(v_employee.salon_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_employee.is_active = p_is_active then
    return v_employee;
  end if;

  select * into v_access
  from public.resolve_salon_access_v1(v_employee.salon_id, pg_catalog.now());

  if not coalesce(v_access.has_full_access, false) then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_ACCESS_REQUIRED';
  end if;

  update public.employees e set
    is_active = p_is_active,
    is_bookable = case when p_is_active then e.is_bookable else false end,
    is_public = case when p_is_active then e.is_public else false end
  where e.id = p_employee_id
  returning e.* into v_employee;

  return v_employee;
end;
$$;

create or replace function public.delete_employee_safely_v1(p_employee_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_access record;
  v_now timestamptz := pg_catalog.now();
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  select e.* into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if not public.is_salon_owner_or_manager(v_employee.salon_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_access
  from public.resolve_salon_access_v1(v_employee.salon_id, v_now);

  if not coalesce(v_access.has_full_access, false) then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_ACCESS_REQUIRED';
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.employee_id = p_employee_id
      and a.status in ('pending', 'confirmed')
      and a.start_time >= v_now
  ) then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_HAS_FUTURE_APPOINTMENTS';
  end if;

  if exists (select 1 from public.appointments a where a.employee_id = p_employee_id) then
    update public.employees e
    set is_active = false, is_bookable = false, is_public = false
    where e.id = p_employee_id;
    return 'soft';
  end if;

  delete from public.employees e where e.id = p_employee_id;
  return 'hard';
end;
$$;

revoke all on function public.update_employee_details_v1(
  uuid, text, text, text, text, text, text, boolean, boolean
) from public, anon;
revoke all on function public.delete_employee_safely_v1(uuid)
  from public, anon;
revoke all on function public.set_employee_active_state(uuid, boolean)
  from public, anon;

revoke all on function public.update_employee_details_v1(
  uuid, text, text, text, text, text, text, boolean, boolean
) from authenticated, service_role;
revoke all on function public.delete_employee_safely_v1(uuid)
  from authenticated, service_role;
revoke all on function public.set_employee_active_state(uuid, boolean)
  from authenticated, service_role;

grant execute on function public.update_employee_details_v1(
  uuid, text, text, text, text, text, text, boolean, boolean
) to authenticated, service_role;
grant execute on function public.delete_employee_safely_v1(uuid)
  to authenticated, service_role;
grant execute on function public.set_employee_active_state(uuid, boolean)
  to authenticated, service_role;

comment on function public.update_employee_details_v1(
  uuid, text, text, text, text, text, text, boolean, boolean
) is 'Updates employee business details only for an authorized salon with canonical full billing access.';
comment on function public.delete_employee_safely_v1(uuid)
  is 'Deletes or deactivates an employee only for an authorized salon with canonical full billing access.';
comment on function public.set_employee_active_state(uuid, boolean)
  is 'Changes employee active state only for an authorized salon with canonical full billing access; activation also remains capacity-trigger protected.';

commit;

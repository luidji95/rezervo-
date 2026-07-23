create or replace function public.update_employee_appointment_status(
  p_appointment_id uuid,
  p_profile_id uuid,
  p_next_status public.appointment_status
)
returns table (
  appointment_id uuid,
  salon_id uuid,
  previous_status public.appointment_status,
  new_status public.appointment_status
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_salon_id uuid;
  v_employee_id uuid;
  v_appointment public.appointments%rowtype;
begin
  select appointment.*
    into v_appointment
  from public.appointments as appointment
  where appointment.id = p_appointment_id
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select membership.salon_id, employee.id
    into v_salon_id, v_employee_id
  from public.salon_members as membership
  join public.employees as employee
    on employee.salon_id = membership.salon_id
   and employee.profile_id = membership.profile_id
  where membership.salon_id = v_appointment.salon_id
    and membership.profile_id = p_profile_id
    and membership.role = 'employee'::public.salon_member_role
    and membership.status = 'active'::public.member_status
    and employee.is_active = true
  limit 1;

  if v_employee_id is null
    or v_appointment.employee_id is distinct from v_employee_id
  then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_appointment.status = p_next_status then
    raise exception 'APPOINTMENT_ALREADY_UPDATED' using errcode = 'P0001';
  end if;

  if not (
    (v_appointment.status = 'pending'::public.appointment_status
      and p_next_status in (
        'confirmed'::public.appointment_status,
        'cancelled'::public.appointment_status
      ))
    or
    (v_appointment.status = 'confirmed'::public.appointment_status
      and p_next_status in (
        'completed'::public.appointment_status,
        'cancelled'::public.appointment_status,
        'no_show'::public.appointment_status
      ))
  ) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  update public.appointments as appointment
  set status = p_next_status
  where appointment.id = v_appointment.id
    and appointment.status = v_appointment.status;

  if not found then
    raise exception 'APPOINTMENT_ALREADY_UPDATED' using errcode = 'P0001';
  end if;

  return query
  select
    v_appointment.id,
    v_appointment.salon_id,
    v_appointment.status,
    p_next_status;
end;
$$;

revoke all on function public.update_employee_appointment_status(
  uuid,
  uuid,
  public.appointment_status
) from public, anon, authenticated;

grant execute on function public.update_employee_appointment_status(
  uuid,
  uuid,
  public.appointment_status
) to service_role;

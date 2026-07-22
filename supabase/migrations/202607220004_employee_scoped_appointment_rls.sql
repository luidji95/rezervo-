create or replace function public.current_employee_id(target_salon_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select employee.id
  from public.employees as employee
  join public.salon_members as membership
    on membership.salon_id = employee.salon_id
   and membership.profile_id = employee.profile_id
  where employee.salon_id = target_salon_id
    and employee.profile_id = auth.uid()
    and employee.is_active = true
    and membership.profile_id = auth.uid()
    and membership.role = 'employee'::public.salon_member_role
    and membership.status = 'active'::public.member_status
  limit 1;
$$;

revoke all on function public.current_employee_id(uuid) from public;
grant execute on function public.current_employee_id(uuid) to authenticated;

drop policy if exists appointments_manage_members
  on public.appointments;

drop policy if exists appointments_select_members
  on public.appointments;

drop policy if exists appointments_manage_owner_or_manager
  on public.appointments;

drop policy if exists appointments_select_employee_own
  on public.appointments;

create policy appointments_manage_owner_or_manager
  on public.appointments
  as permissive
  for all
  to authenticated
  using (public.is_salon_owner_or_manager(salon_id))
  with check (public.is_salon_owner_or_manager(salon_id));

create policy appointments_select_employee_own
  on public.appointments
  as permissive
  for select
  to authenticated
  using (
    employee_id = public.current_employee_id(salon_id)
  );

drop policy if exists appointment_services_manage_members
  on public.appointment_services;

drop policy if exists appointment_services_select_members
  on public.appointment_services;

drop policy if exists appointment_services_manage_owner_or_manager
  on public.appointment_services;

drop policy if exists appointment_services_select_employee_own
  on public.appointment_services;

create policy appointment_services_manage_owner_or_manager
  on public.appointment_services
  as permissive
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.appointments as appointment
      where appointment.id = appointment_services.appointment_id
        and public.is_salon_owner_or_manager(appointment.salon_id)
    )
  )
  with check (
    exists (
      select 1
      from public.appointments as appointment
      where appointment.id = appointment_services.appointment_id
        and public.is_salon_owner_or_manager(appointment.salon_id)
    )
  );

create policy appointment_services_select_employee_own
  on public.appointment_services
  as permissive
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.appointments as appointment
      where appointment.id = appointment_services.appointment_id
        and appointment.employee_id =
          public.current_employee_id(appointment.salon_id)
    )
  );

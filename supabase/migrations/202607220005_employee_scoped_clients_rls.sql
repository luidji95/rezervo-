drop policy if exists clients_manage_members
  on public.clients;

drop policy if exists clients_select_members
  on public.clients;

drop policy if exists clients_manage_owner_or_manager
  on public.clients;

create policy clients_manage_owner_or_manager
  on public.clients
  as permissive
  for all
  to authenticated
  using (public.is_salon_owner_or_manager(salon_id))
  with check (public.is_salon_owner_or_manager(salon_id));

create or replace function public.get_employee_appointment_clients(
  target_salon_id uuid
)
returns table (
  id uuid,
  full_name text,
  phone text,
  email text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select distinct
    client.id,
    client.full_name,
    client.phone,
    client.email
  from public.clients as client
  join public.appointments as appointment
    on appointment.client_id = client.id
   and appointment.salon_id = client.salon_id
  where client.salon_id = target_salon_id
    and appointment.employee_id = public.current_employee_id(target_salon_id);
$$;

revoke all on function public.get_employee_appointment_clients(uuid)
  from public;
grant execute on function public.get_employee_appointment_clients(uuid)
  to authenticated;

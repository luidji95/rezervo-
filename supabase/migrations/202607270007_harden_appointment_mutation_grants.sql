begin;

drop policy if exists appointments_manage_owner_or_manager on public.appointments;
create policy appointments_select_owner_or_manager on public.appointments
for select to authenticated using (public.is_salon_owner_or_manager(appointments.salon_id));

drop policy if exists appointment_services_manage_owner_or_manager on public.appointment_services;
create policy appointment_services_select_owner_or_manager on public.appointment_services
for select to authenticated using (exists(select 1 from public.appointments a where a.id=appointment_services.appointment_id and public.is_salon_owner_or_manager(a.salon_id)));

revoke insert,update,delete,truncate,references,trigger on table public.appointments from authenticated,anon;
revoke insert,update,delete,truncate,references,trigger on table public.appointment_services from authenticated,anon;
revoke all on table public.appointments from anon;
revoke all on table public.appointment_services from anon;
grant select on table public.appointments to authenticated;
grant select on table public.appointment_services to authenticated;
grant all on table public.appointments to service_role;
grant all on table public.appointment_services to service_role;

comment on policy appointments_select_owner_or_manager on public.appointments is 'Read-only owner/manager appointment access; writes use narrow RPC gateways.';
comment on policy appointment_services_select_owner_or_manager on public.appointment_services is 'Read-only owner/manager snapshot access; writes use appointment RPC gateways.';

commit;

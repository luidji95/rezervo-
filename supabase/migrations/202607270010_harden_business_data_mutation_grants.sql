-- Phase 6C, step 2. Apply only after the compatible application has moved all
-- business mutations to the gateways introduced by 202607270009.

drop policy if exists clients_manage_owner_or_manager on public.clients;
create policy clients_select_owner_or_manager on public.clients
  for select to authenticated using (public.is_salon_owner_or_manager(clients.salon_id));

drop policy if exists services_manage_owner_or_manager on public.services;
drop policy if exists service_categories_manage_owner_or_manager on public.service_categories;
drop policy if exists employee_services_manage_owner_or_manager on public.employee_services;

revoke all on table public.clients from anon, authenticated;
revoke all on table public.services from anon, authenticated;
revoke all on table public.service_categories from anon, authenticated;
revoke all on table public.employee_services from anon, authenticated;

grant select on table public.clients to authenticated;
grant select on table public.services to authenticated;
grant select on table public.service_categories to authenticated;
grant select on table public.employee_services to authenticated;

comment on table public.clients is 'Tenant client data. Browser writes are allowed only through Phase 6C RPC gateways.';
comment on table public.services is 'Salon services. Browser writes are allowed only through Phase 6C RPC gateways.';
comment on table public.service_categories is 'Salon service categories. Browser writes are allowed only through Phase 6C RPC gateways.';
comment on table public.employee_services is 'Employee/service assignments. Browser writes are allowed only through Phase 6C RPC gateways.';

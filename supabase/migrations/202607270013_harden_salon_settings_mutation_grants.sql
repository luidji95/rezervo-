-- Phase 6D, step 2: remove direct browser mutation paths after the compatible app deploy.

drop policy if exists salons_update_owner_or_manager on public.salons;
drop policy if exists salons_delete_owner on public.salons;
drop policy if exists working_hours_manage_owner_or_manager on public.working_hours;
drop policy if exists closures_manage_owner_or_manager on public.closures;
drop policy if exists resources_manage_owner_or_manager on public.resources;
drop policy if exists integrations_manage_owner_or_manager on public.integrations;
drop policy if exists salon_members_update_owner_or_manager on public.salon_members;
drop policy if exists salon_members_delete_owner on public.salon_members;

revoke all on public.salons from anon,authenticated;
grant select on public.salons to anon,authenticated;
grant insert on public.salons to authenticated;

revoke all on public.working_hours from anon,authenticated;
grant select on public.working_hours to authenticated;
revoke all on public.closures from anon,authenticated;
grant select on public.closures to authenticated;
revoke all on public.resources from anon,authenticated;
grant select on public.resources to authenticated;
revoke all on public.integrations from anon,authenticated;
grant select on public.integrations to authenticated;
revoke all on public.salon_members from anon,authenticated;
grant select,insert on public.salon_members to authenticated;

-- Public booking reads use the SECURITY DEFINER bootstrap/availability contracts;
-- no mutation privilege is restored to anon.

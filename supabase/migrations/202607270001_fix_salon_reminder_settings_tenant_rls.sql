-- Restrict reminder settings reads to the owner or an active owner/manager
-- membership of the same salon. No write privileges or policies are changed.

drop policy if exists salon_reminder_settings_owner_manager_read
  on public.salon_reminder_settings;

create policy salon_reminder_settings_owner_manager_read
on public.salon_reminder_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.salons as owned_salon
    where owned_salon.id = salon_reminder_settings.salon_id
      and owned_salon.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.salon_members as member
    where member.salon_id = salon_reminder_settings.salon_id
      and member.profile_id = auth.uid()
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  )
);

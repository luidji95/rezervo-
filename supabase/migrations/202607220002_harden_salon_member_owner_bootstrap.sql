drop policy if exists "Salon owners can create their own membership"
  on public.salon_members;

drop policy if exists salon_members_insert_owner_or_manager
  on public.salon_members;

drop policy if exists salon_members_insert_owner_bootstrap
  on public.salon_members;

create policy salon_members_insert_owner_bootstrap
  on public.salon_members
  as permissive
  for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and role = 'owner'::public.salon_member_role
    and status = 'active'::public.member_status
    and exists (
      select 1
      from public.salons
      where salons.id = salon_members.salon_id
        and salons.owner_id = auth.uid()
    )
  );

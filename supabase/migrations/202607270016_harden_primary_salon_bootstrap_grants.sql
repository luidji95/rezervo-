-- Phase 7A.0, step B: remove superseded direct browser bootstrap paths.
drop policy if exists "Authenticated users can create their own salon" on public.salons;
drop policy if exists salon_members_insert_owner_bootstrap on public.salon_members;
revoke insert on public.salons from authenticated;
revoke insert on public.salon_members from authenticated;

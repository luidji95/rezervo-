-- Phase 6D, step 1: additive salon/settings mutation gateways.

create or replace function public.update_salon_profile_v1(
  p_salon_id uuid, p_name text, p_phone text default null, p_email text default null,
  p_website_url text default null, p_instagram_url text default null,
  p_city text default null, p_address_line text default null, p_description text default null
) returns public.salons
language plpgsql security definer set search_path = '' as $$
declare v_salon public.salons; v_name text := pg_catalog.btrim(coalesce(p_name,''));
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if v_name = '' or char_length(v_name) > 200 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  update public.salons s set name=v_name, phone=nullif(pg_catalog.btrim(coalesce(p_phone,'')),''),
    email=nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,''))),''),
    website_url=nullif(pg_catalog.btrim(coalesce(p_website_url,'')),''),
    instagram_url=nullif(pg_catalog.btrim(coalesce(p_instagram_url,'')),''),
    city=nullif(pg_catalog.btrim(coalesce(p_city,'')),''),
    address_line=nullif(pg_catalog.btrim(coalesce(p_address_line,'')),''),
    description=nullif(pg_catalog.btrim(coalesce(p_description,'')),''), updated_at=pg_catalog.now()
  where s.id=p_salon_id returning * into v_salon;
  if not found then raise exception using errcode='P0001',message='SALON_NOT_FOUND'; end if;
  return v_salon;
end $$;

create or replace function public.update_onboarding_salon_v1(
  p_salon_id uuid, p_name text, p_slug text, p_business_type public.business_type,
  p_phone text default null, p_email text default null, p_address_line text default null,
  p_website_url text default null, p_instagram_url text default null, p_description text default null
) returns public.salons
language plpgsql security definer set search_path='' as $$
declare v_salon public.salons; v_name text:=pg_catalog.btrim(coalesce(p_name,'')); v_slug text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug,'')));
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if v_name='' or v_slug='' or char_length(v_name)>200 or char_length(v_slug)>120 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  update public.salons s set name=v_name,slug=v_slug,business_type=p_business_type,
    phone=nullif(pg_catalog.btrim(coalesce(p_phone,'')),''),email=nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,''))),''),
    address_line=nullif(pg_catalog.btrim(coalesce(p_address_line,'')),''),website_url=nullif(pg_catalog.btrim(coalesce(p_website_url,'')),''),
    instagram_url=nullif(pg_catalog.btrim(coalesce(p_instagram_url,'')),''),description=nullif(pg_catalog.btrim(coalesce(p_description,'')),''),
    onboarding_completed=true,onboarding_step=1,updated_at=pg_catalog.now()
  where s.id=p_salon_id returning * into v_salon;
  if not found then raise exception using errcode='P0001',message='SALON_NOT_FOUND'; end if;
  return v_salon;
exception when unique_violation then raise exception using errcode='P0001',message='SLUG_CONFLICT';
end $$;

create or replace function public.set_salon_onboarding_state_v1(p_salon_id uuid,p_completed boolean,p_step integer)
returns public.salons language plpgsql security definer set search_path='' as $$
declare v_salon public.salons;
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if p_step < 0 or p_step > 20 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  update public.salons s set onboarding_completed=p_completed,onboarding_step=p_step,updated_at=pg_catalog.now()
  where s.id=p_salon_id returning * into v_salon;
  if not found then raise exception using errcode='P0001',message='SALON_NOT_FOUND'; end if;
  return v_salon;
end $$;

create or replace function public.upsert_working_hour_v1(
 p_salon_id uuid,p_employee_id uuid,p_day_of_week integer,p_opens_at time,p_closes_at time,
 p_break_starts_at time default null,p_break_ends_at time default null,p_is_working_day boolean default true
) returns public.working_hours language plpgsql security definer set search_path='' as $$
declare v_row public.working_hours;
begin
 perform public.assert_salon_admin_write_access_v1(p_salon_id);
 if p_day_of_week < 0 or p_day_of_week > 6 or (p_is_working_day and p_opens_at >= p_closes_at)
   or ((p_break_starts_at is null) <> (p_break_ends_at is null))
   or (p_break_starts_at is not null and (p_break_starts_at < p_opens_at or p_break_ends_at > p_closes_at or p_break_starts_at >= p_break_ends_at))
 then raise exception using errcode='P0001',message='INVALID_WORKING_HOURS'; end if;
 if p_employee_id is not null and not exists(select 1 from public.employees e where e.id=p_employee_id and e.salon_id=p_salon_id)
 then raise exception using errcode='P0001',message='CROSS_TENANT_REFERENCE'; end if;
 select * into v_row from public.working_hours wh where wh.salon_id=p_salon_id and wh.employee_id is not distinct from p_employee_id and wh.day_of_week=p_day_of_week for update;
 if found then
   update public.working_hours wh set opens_at=p_opens_at,closes_at=p_closes_at,break_starts_at=p_break_starts_at,
     break_ends_at=p_break_ends_at,is_working_day=p_is_working_day,updated_at=pg_catalog.now()
   where wh.id=v_row.id returning * into v_row;
 else
   insert into public.working_hours(salon_id,employee_id,day_of_week,opens_at,closes_at,break_starts_at,break_ends_at,is_working_day)
   values(p_salon_id,p_employee_id,p_day_of_week,p_opens_at,p_closes_at,p_break_starts_at,p_break_ends_at,p_is_working_day)
   returning * into v_row;
 end if;
 return v_row;
end $$;

create or replace function public.create_closure_v1(
 p_salon_id uuid,p_employee_id uuid,p_title text,p_reason text,p_starts_at timestamptz,p_ends_at timestamptz,p_is_full_day boolean
) returns public.closures language plpgsql security definer set search_path='' as $$
declare v_row public.closures; v_title text:=pg_catalog.btrim(coalesce(p_title,''));
begin
 perform public.assert_salon_admin_write_access_v1(p_salon_id);
 if v_title='' or char_length(v_title)>200 or p_starts_at>=p_ends_at then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
 if p_employee_id is not null and not exists(select 1 from public.employees e where e.id=p_employee_id and e.salon_id=p_salon_id)
 then raise exception using errcode='P0001',message='CROSS_TENANT_REFERENCE'; end if;
 insert into public.closures(salon_id,employee_id,title,reason,starts_at,ends_at,is_full_day,created_by)
 values(p_salon_id,p_employee_id,v_title,nullif(pg_catalog.btrim(coalesce(p_reason,'')),''),p_starts_at,p_ends_at,p_is_full_day,auth.uid())
 returning * into v_row; return v_row;
end $$;

create or replace function public.delete_closure_v1(p_closure_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_salon_id uuid;
begin
 select c.salon_id into v_salon_id from public.closures c where c.id=p_closure_id for update;
 if not found then raise exception using errcode='P0001',message='CLOSURE_NOT_FOUND'; end if;
 perform public.assert_salon_admin_write_access_v1(v_salon_id);
 delete from public.closures c where c.id=p_closure_id; return p_closure_id;
end $$;

revoke all on function public.update_salon_profile_v1(uuid,text,text,text,text,text,text,text,text) from public,anon;
revoke all on function public.update_onboarding_salon_v1(uuid,text,text,public.business_type,text,text,text,text,text,text) from public,anon;
revoke all on function public.set_salon_onboarding_state_v1(uuid,boolean,integer) from public,anon;
revoke all on function public.upsert_working_hour_v1(uuid,uuid,integer,time,time,time,time,boolean) from public,anon;
revoke all on function public.create_closure_v1(uuid,uuid,text,text,timestamptz,timestamptz,boolean) from public,anon;
revoke all on function public.delete_closure_v1(uuid) from public,anon;
grant execute on function public.update_salon_profile_v1(uuid,text,text,text,text,text,text,text,text) to authenticated,service_role;
grant execute on function public.update_onboarding_salon_v1(uuid,text,text,public.business_type,text,text,text,text,text,text) to authenticated,service_role;
grant execute on function public.set_salon_onboarding_state_v1(uuid,boolean,integer) to authenticated,service_role;
grant execute on function public.upsert_working_hour_v1(uuid,uuid,integer,time,time,time,time,boolean) to authenticated,service_role;
grant execute on function public.create_closure_v1(uuid,uuid,text,text,timestamptz,timestamptz,boolean) to authenticated,service_role;
grant execute on function public.delete_closure_v1(uuid) to authenticated,service_role;

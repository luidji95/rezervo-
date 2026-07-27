-- Phase 6C, step 1: authenticated, tenant-scoped mutation gateways.
-- This migration is additive so the application can move off direct PostgREST
-- writes before the restrictive grants migration is applied.

create or replace function public.assert_salon_admin_write_access_v1(p_salon_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access record;
begin
  if p_salon_id is null or not public.is_salon_owner_or_manager(p_salon_id) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select * into v_access
  from public.resolve_salon_access_v1(p_salon_id, pg_catalog.now());

  if not coalesce(v_access.has_full_access, false) then
    raise exception using errcode = 'P0001', message = 'SALON_WRITE_ACCESS_REQUIRED';
  end if;
end;
$$;

revoke all on function public.assert_salon_admin_write_access_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_owner_client_v1(
  p_salon_id uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_source text default 'manual'
)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(coalesce(p_full_name, ''));
  v_phone text := nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_phone, '')), '[\s()\-]', '', 'g'), '');
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), '');
  v_source text := coalesce(nullif(pg_catalog.btrim(p_source), ''), 'manual');
  v_client public.clients;
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if v_name = '' or char_length(v_name) > 200 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if v_source not in ('manual', 'instagram', 'public', 'whatsapp', 'referral') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if exists (
    select 1 from public.clients c
    where c.salon_id = p_salon_id
      and ((v_phone is not null and pg_catalog.regexp_replace(coalesce(c.phone, ''), '[\s()\-]', '', 'g') = v_phone)
        or (v_email is not null and pg_catalog.lower(coalesce(c.email, '')) = v_email))
  ) then
    raise exception using errcode = 'P0001', message = 'CLIENT_CONTACT_CONFLICT';
  end if;

  insert into public.clients (salon_id, full_name, phone, email, source)
  values (p_salon_id, v_name, v_phone, v_email, v_source)
  returning * into v_client;
  return v_client;
end;
$$;

create or replace function public.update_owner_client_v1(
  p_client_id uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_source text default 'manual',
  p_notes text default null
)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_name text := pg_catalog.btrim(coalesce(p_full_name, ''));
  v_phone text := nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_phone, '')), '[\s()\-]', '', 'g'), '');
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), '');
  v_source text := coalesce(nullif(pg_catalog.btrim(p_source), ''), 'manual');
begin
  select * into v_client from public.clients c where c.id = p_client_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND'; end if;
  perform public.assert_salon_admin_write_access_v1(v_client.salon_id);
  if v_name = '' or char_length(v_name) > 200 or v_source not in ('manual', 'instagram', 'public', 'whatsapp', 'referral') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if exists (
    select 1 from public.clients c
    where c.salon_id = v_client.salon_id and c.id <> p_client_id
      and ((v_phone is not null and pg_catalog.regexp_replace(coalesce(c.phone, ''), '[\s()\-]', '', 'g') = v_phone)
        or (v_email is not null and pg_catalog.lower(coalesce(c.email, '')) = v_email))
  ) then
    raise exception using errcode = 'P0001', message = 'CLIENT_CONTACT_CONFLICT';
  end if;

  update public.clients c set
    full_name = v_name, phone = v_phone, email = v_email,
    source = v_source, notes = coalesce(p_notes, v_client.notes), updated_at = pg_catalog.now()
  where c.id = p_client_id returning * into v_client;
  return v_client;
end;
$$;

create or replace function public.set_client_status_v1(p_client_id uuid, p_status public.client_status)
returns public.clients
language plpgsql security definer set search_path = ''
as $$
declare v_client public.clients;
begin
  select * into v_client from public.clients c where c.id = p_client_id for update;
  if not found then raise exception using errcode='P0001', message='CLIENT_NOT_FOUND'; end if;
  perform public.assert_salon_admin_write_access_v1(v_client.salon_id);
  update public.clients c set status=p_status, updated_at=pg_catalog.now()
  where c.id=p_client_id returning * into v_client;
  return v_client;
end;
$$;

create or replace function public.delete_client_safely_v1(p_client_id uuid)
returns table(mode text, client_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_client public.clients;
begin
  select * into v_client from public.clients c where c.id=p_client_id for update;
  if not found then raise exception using errcode='P0001', message='CLIENT_NOT_FOUND'; end if;
  perform public.assert_salon_admin_write_access_v1(v_client.salon_id);
  if exists (select 1 from public.appointments a where a.client_id=p_client_id) then
    update public.clients c set status='archived', updated_at=pg_catalog.now() where c.id=p_client_id;
    return query select 'soft'::text, p_client_id;
  else
    delete from public.clients c where c.id=p_client_id;
    return query select 'hard'::text, p_client_id;
  end if;
end;
$$;

create or replace function public.create_service_v1(
  p_salon_id uuid, p_name text, p_description text, p_category_name text,
  p_duration_minutes integer, p_price numeric,
  p_is_active boolean default true, p_is_public boolean default true,
  p_buffer_minutes integer default 0, p_category_id uuid default null,
  p_currency text default null, p_color text default null, p_sort_order integer default 0
)
returns public.services
language plpgsql security definer set search_path = ''
as $$
declare v_service public.services; v_name text:=pg_catalog.btrim(coalesce(p_name,''));
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if v_name='' or char_length(v_name)>200 or p_duration_minutes<=0 or p_duration_minutes>1440
    or p_buffer_minutes<0 or p_price<0 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.service_categories sc where sc.id=p_category_id and sc.salon_id=p_salon_id
  ) then raise exception using errcode='P0001', message='CROSS_TENANT_REFERENCE'; end if;
  insert into public.services (
    salon_id,category_id,category_name,name,description,duration_minutes,buffer_minutes,
    price,currency,is_active,is_public,color,sort_order
  ) values (
    p_salon_id,p_category_id,nullif(pg_catalog.btrim(coalesce(p_category_name,'')),''),v_name,
    nullif(pg_catalog.btrim(coalesce(p_description,'')),''),p_duration_minutes,p_buffer_minutes,
    p_price,coalesce(nullif(pg_catalog.btrim(p_currency),''),'EUR'),p_is_active,p_is_public,p_color,p_sort_order
  ) returning * into v_service;
  return v_service;
end;
$$;

create or replace function public.update_service_v1(
  p_service_id uuid, p_name text, p_description text, p_category_name text,
  p_duration_minutes integer, p_price numeric,
  p_is_active boolean, p_is_public boolean,
  p_buffer_minutes integer default 0, p_category_id uuid default null,
  p_currency text default null, p_color text default null, p_sort_order integer default 0
)
returns public.services
language plpgsql security definer set search_path = ''
as $$
declare v_service public.services; v_name text:=pg_catalog.btrim(coalesce(p_name,''));
begin
  select * into v_service from public.services s where s.id=p_service_id for update;
  if not found then raise exception using errcode='P0001', message='SERVICE_NOT_FOUND'; end if;
  perform public.assert_salon_admin_write_access_v1(v_service.salon_id);
  if v_name='' or char_length(v_name)>200 or p_duration_minutes<=0 or p_duration_minutes>1440
    or p_buffer_minutes<0 or p_price<0 then raise exception using errcode='P0001', message='INVALID_INPUT'; end if;
  if p_category_id is not null and not exists (
    select 1 from public.service_categories sc where sc.id=p_category_id and sc.salon_id=v_service.salon_id
  ) then raise exception using errcode='P0001', message='CROSS_TENANT_REFERENCE'; end if;
  update public.services s set
    category_id=p_category_id, category_name=nullif(pg_catalog.btrim(coalesce(p_category_name,'')),''),
    name=v_name, description=nullif(pg_catalog.btrim(coalesce(p_description,'')),''),
    duration_minutes=p_duration_minutes, buffer_minutes=p_buffer_minutes, price=p_price,
    currency=coalesce(nullif(pg_catalog.btrim(p_currency),''),v_service.currency),
    is_active=p_is_active, is_public=p_is_public, color=p_color, sort_order=p_sort_order,
    updated_at=pg_catalog.now()
  where s.id=p_service_id returning * into v_service;
  return v_service;
end;
$$;

create or replace function public.set_service_active_state_v1(p_service_id uuid, p_is_active boolean)
returns public.services language plpgsql security definer set search_path=''
as $$
declare v_service public.services;
begin
  select * into v_service from public.services s where s.id=p_service_id for update;
  if not found then raise exception using errcode='P0001', message='SERVICE_NOT_FOUND'; end if;
  perform public.assert_salon_admin_write_access_v1(v_service.salon_id);
  update public.services s set is_active=p_is_active,
    is_public=case when p_is_active then s.is_public else false end,
    updated_at=pg_catalog.now() where s.id=p_service_id returning * into v_service;
  return v_service;
end;
$$;

create or replace function public.delete_service_safely_v1(p_service_id uuid)
returns table(mode text, service_id uuid)
language plpgsql security definer set search_path=''
as $$
declare v_service public.services;
begin
  select * into v_service from public.services s where s.id=p_service_id for update;
  if not found then raise exception using errcode='P0001', message='SERVICE_NOT_FOUND'; end if;
  perform public.assert_salon_admin_write_access_v1(v_service.salon_id);
  if exists(select 1 from public.appointment_services aps where aps.service_id=p_service_id)
    or exists(select 1 from public.employee_services es where es.service_id=p_service_id) then
    update public.services s set is_active=false,is_public=false,updated_at=pg_catalog.now() where s.id=p_service_id;
    return query select 'soft'::text,p_service_id;
  else
    delete from public.services s where s.id=p_service_id;
    return query select 'hard'::text,p_service_id;
  end if;
end;
$$;

create or replace function public.create_service_category_v1(
  p_salon_id uuid,p_name text,p_description text default null,p_sort_order integer default 0
)
returns public.service_categories language plpgsql security definer set search_path=''
as $$
declare v_category public.service_categories;v_name text:=pg_catalog.btrim(coalesce(p_name,''));
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if v_name='' or char_length(v_name)>120 then raise exception using errcode='P0001',message='INVALID_INPUT';end if;
  insert into public.service_categories(salon_id,name,description,sort_order)
  values(p_salon_id,v_name,nullif(pg_catalog.btrim(coalesce(p_description,'')),''),p_sort_order)
  returning * into v_category;return v_category;
exception when unique_violation then raise exception using errcode='P0001',message='INVALID_INPUT';
end;
$$;

create or replace function public.update_service_category_v1(
  p_category_id uuid,p_name text,p_description text,p_sort_order integer,p_is_active boolean
)
returns public.service_categories language plpgsql security definer set search_path=''
as $$
declare v_category public.service_categories;v_name text:=pg_catalog.btrim(coalesce(p_name,''));
begin
  select * into v_category from public.service_categories sc where sc.id=p_category_id for update;
  if not found then raise exception using errcode='P0001',message='CATEGORY_NOT_FOUND';end if;
  perform public.assert_salon_admin_write_access_v1(v_category.salon_id);
  if v_name='' or char_length(v_name)>120 then raise exception using errcode='P0001',message='INVALID_INPUT';end if;
  update public.service_categories sc set name=v_name,
    description=nullif(pg_catalog.btrim(coalesce(p_description,'')),''),sort_order=p_sort_order,
    is_active=p_is_active,updated_at=pg_catalog.now() where sc.id=p_category_id returning * into v_category;
  return v_category;
exception when unique_violation then raise exception using errcode='P0001',message='INVALID_INPUT';
end;
$$;

create or replace function public.delete_service_category_v1(p_category_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_salon_id uuid;
begin
  select sc.salon_id into v_salon_id from public.service_categories sc where sc.id=p_category_id for update;
  if not found then raise exception using errcode='P0001',message='CATEGORY_NOT_FOUND';end if;
  perform public.assert_salon_admin_write_access_v1(v_salon_id);
  if exists(select 1 from public.services s where s.category_id=p_category_id) then
    raise exception using errcode='P0001',message='CATEGORY_IN_USE';
  end if;
  delete from public.service_categories sc where sc.id=p_category_id;return p_category_id;
end;
$$;

create or replace function public.upsert_employee_service_assignment_v1(
  p_salon_id uuid,p_employee_id uuid,p_service_id uuid,
  p_custom_duration_minutes integer default null,p_custom_price numeric default null,p_is_active boolean default true
)
returns public.employee_services language plpgsql security definer set search_path=''
as $$
declare v_assignment public.employee_services;
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if (p_custom_duration_minutes is not null and p_custom_duration_minutes<=0)
    or (p_custom_price is not null and p_custom_price<0) then
    raise exception using errcode='P0001',message='INVALID_INPUT';
  end if;
  if not exists(select 1 from public.employees e where e.id=p_employee_id and e.salon_id=p_salon_id) then
    raise exception using errcode='P0001',message='EMPLOYEE_NOT_FOUND';end if;
  if not exists(select 1 from public.services s where s.id=p_service_id and s.salon_id=p_salon_id) then
    raise exception using errcode='P0001',message='CROSS_TENANT_REFERENCE';end if;
  insert into public.employee_services(salon_id,employee_id,service_id,custom_duration_minutes,custom_price,is_active)
  values(p_salon_id,p_employee_id,p_service_id,p_custom_duration_minutes,p_custom_price,p_is_active)
  on conflict(employee_id,service_id) do update set
    custom_duration_minutes=excluded.custom_duration_minutes,custom_price=excluded.custom_price,is_active=excluded.is_active
  returning * into v_assignment;return v_assignment;
end;
$$;

create or replace function public.sync_employee_service_assignments_v1(
  p_salon_id uuid,p_employee_id uuid,p_service_ids uuid[]
)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_ids uuid[]:=coalesce(p_service_ids,'{}'::uuid[]);v_count integer;
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  perform 1 from public.employees e where e.id=p_employee_id and e.salon_id=p_salon_id for update;
  if not found then raise exception using errcode='P0001',message='EMPLOYEE_NOT_FOUND';end if;
  if cardinality(v_ids)<>(select count(distinct x) from pg_catalog.unnest(v_ids) x) then
    raise exception using errcode='P0001',message='INVALID_INPUT';end if;
  if exists(select 1 from pg_catalog.unnest(v_ids) x left join public.services s
    on s.id=x and s.salon_id=p_salon_id and s.is_active where s.id is null) then
    raise exception using errcode='P0001',message='CROSS_TENANT_REFERENCE';end if;
  update public.employee_services es set is_active=false
    where es.salon_id=p_salon_id and es.employee_id=p_employee_id
      and not(es.service_id=any(v_ids)) and es.is_active;
  insert into public.employee_services(salon_id,employee_id,service_id,is_active)
    select p_salon_id,p_employee_id,x,true from pg_catalog.unnest(v_ids) x
    on conflict(employee_id,service_id) do update set is_active=true;
  select count(*) into v_count from public.employee_services es
    where es.salon_id=p_salon_id and es.employee_id=p_employee_id and es.is_active;
  return v_count;
end;
$$;

create or replace function public.remove_employee_service_assignment_v1(
  p_employee_id uuid,p_service_id uuid
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_assignment_id uuid;v_salon_id uuid;
begin
  select es.id,es.salon_id into v_assignment_id,v_salon_id
  from public.employee_services es
  where es.employee_id=p_employee_id and es.service_id=p_service_id for update;
  if not found then raise exception using errcode='P0001',message='SERVICE_NOT_ASSIGNED';end if;
  perform public.assert_salon_admin_write_access_v1(v_salon_id);
  delete from public.employee_services es where es.id=v_assignment_id;
  return v_assignment_id;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure signature from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_owner_client_v1','update_owner_client_v1','set_client_status_v1','delete_client_safely_v1',
      'create_service_v1','update_service_v1','set_service_active_state_v1','delete_service_safely_v1',
      'create_service_category_v1','update_service_category_v1','delete_service_category_v1',
      'upsert_employee_service_assignment_v1','sync_employee_service_assignments_v1',
      'remove_employee_service_assignment_v1'
    )
  loop
    execute format('revoke all on function %s from public, anon',r.signature);
    execute format('grant execute on function %s to authenticated',r.signature);
  end loop;
end $$;

comment on function public.assert_salon_admin_write_access_v1(uuid) is
  'Internal Phase 6C owner/manager and full-subscription write assertion.';

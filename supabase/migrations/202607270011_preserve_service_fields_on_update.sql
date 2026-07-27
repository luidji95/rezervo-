-- Preserve service fields that the current edit UI does not submit.
create or replace function public.update_service_v1(
  p_service_id uuid, p_name text, p_description text, p_category_name text,
  p_duration_minutes integer, p_price numeric,
  p_is_active boolean, p_is_public boolean,
  p_buffer_minutes integer default null, p_category_id uuid default null,
  p_currency text default null, p_color text default null, p_sort_order integer default null
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
    or coalesce(p_buffer_minutes,v_service.buffer_minutes)<0 or p_price<0 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.service_categories sc where sc.id=p_category_id and sc.salon_id=v_service.salon_id
  ) then raise exception using errcode='P0001', message='CROSS_TENANT_REFERENCE'; end if;
  update public.services s set
    category_id=coalesce(p_category_id,v_service.category_id),
    category_name=nullif(pg_catalog.btrim(coalesce(p_category_name,'')),''),
    name=v_name, description=nullif(pg_catalog.btrim(coalesce(p_description,'')),''),
    duration_minutes=p_duration_minutes,
    buffer_minutes=coalesce(p_buffer_minutes,v_service.buffer_minutes), price=p_price,
    currency=coalesce(nullif(pg_catalog.btrim(p_currency),''),v_service.currency),
    is_active=p_is_active, is_public=p_is_public,
    color=coalesce(p_color,v_service.color), sort_order=coalesce(p_sort_order,v_service.sort_order),
    updated_at=pg_catalog.now()
  where s.id=p_service_id returning * into v_service;
  return v_service;
end;
$$;

revoke all on function public.update_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer)
  from public,anon;
grant execute on function public.update_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer)
  to authenticated;

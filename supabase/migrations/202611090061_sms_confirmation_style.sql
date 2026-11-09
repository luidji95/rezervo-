begin;

-- SMS confirmation style chosen by the salon, and an optional category per service for the playful style.
-- * salon_reminder_settings.sms_confirmation_style: business, casual or playful. Null (every existing salon and every
--   new one until the owner chooses) keeps the standard confirmation text. Saved with the other SMS settings.
-- * services.sms_humor_category: haircut, coloring or massage. Null is universal. It only picks the playful template
--   set; the salon's free-text category is not used and nothing is guessed from the service name.
-- * create_service_v1 / update_service_v1 take p_sms_humor_category (null, 'universal', 'haircut', 'coloring',
--   'massage'). On update, null keeps the stored value, so callers that do not send it change nothing; 'universal'
--   clears it. The functions are recreated with the extra trailing argument (an overload would make named calls
--   ambiguous); all other behavior is unchanged.
-- Sending, reservation of the one attempt, limits, reminders and entitlements are unchanged.

alter table public.salon_reminder_settings
  add column sms_confirmation_style text
  constraint salon_reminder_settings_sms_confirmation_style_check
    check (sms_confirmation_style in ('business', 'casual', 'playful'));

comment on column public.salon_reminder_settings.sms_confirmation_style is
  'Confirmation SMS style: business, casual or playful. Null sends the standard confirmation text.';

alter table public.services
  add column sms_humor_category text
  constraint services_sms_humor_category_check
    check (sms_humor_category in ('haircut', 'coloring', 'massage'));

comment on column public.services.sms_humor_category is
  'Template set for the playful confirmation SMS: haircut, coloring or massage. Null is universal.';

drop function public.create_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer);
drop function public.update_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer);

create function public.create_service_v1(
  p_salon_id uuid, p_name text, p_description text, p_category_name text,
  p_duration_minutes integer, p_price numeric,
  p_is_active boolean default true, p_is_public boolean default true,
  p_buffer_minutes integer default 0, p_category_id uuid default null,
  p_currency text default null, p_color text default null, p_sort_order integer default 0,
  p_sms_humor_category text default null
)
returns public.services
language plpgsql security definer set search_path = ''
as $$
declare v_service public.services; v_name text:=pg_catalog.btrim(coalesce(p_name,''));
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if v_name='' or char_length(v_name)>200 or p_duration_minutes<=0 or p_duration_minutes>1440
    or p_buffer_minutes<0 or p_price<0
    or (p_sms_humor_category is not null and p_sms_humor_category not in ('universal','haircut','coloring','massage')) then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.service_categories sc where sc.id=p_category_id and sc.salon_id=p_salon_id
  ) then raise exception using errcode='P0001', message='CROSS_TENANT_REFERENCE'; end if;
  insert into public.services (
    salon_id,category_id,category_name,name,description,duration_minutes,buffer_minutes,
    price,currency,is_active,is_public,color,sort_order,sms_humor_category
  ) values (
    p_salon_id,p_category_id,nullif(pg_catalog.btrim(coalesce(p_category_name,'')),''),v_name,
    nullif(pg_catalog.btrim(coalesce(p_description,'')),''),p_duration_minutes,p_buffer_minutes,
    p_price,coalesce(nullif(pg_catalog.btrim(p_currency),''),'EUR'),p_is_active,p_is_public,p_color,p_sort_order,
    nullif(p_sms_humor_category,'universal')
  ) returning * into v_service;
  return v_service;
end;
$$;

-- Same as 202607270011 (fields the edit UI does not submit are preserved), plus the playful SMS category.
create function public.update_service_v1(
  p_service_id uuid, p_name text, p_description text, p_category_name text,
  p_duration_minutes integer, p_price numeric,
  p_is_active boolean, p_is_public boolean,
  p_buffer_minutes integer default null, p_category_id uuid default null,
  p_currency text default null, p_color text default null, p_sort_order integer default null,
  p_sms_humor_category text default null
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
    or coalesce(p_buffer_minutes,v_service.buffer_minutes)<0 or p_price<0
    or (p_sms_humor_category is not null and p_sms_humor_category not in ('universal','haircut','coloring','massage')) then
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
    sms_humor_category=case
      when p_sms_humor_category is null then v_service.sms_humor_category
      else nullif(p_sms_humor_category,'universal')
    end,
    updated_at=pg_catalog.now()
  where s.id=p_service_id returning * into v_service;
  return v_service;
end;
$$;

revoke all on function public.create_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer,text)
  from public,anon;
grant execute on function public.create_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer,text)
  to authenticated;
revoke all on function public.update_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer,text)
  from public,anon;
grant execute on function public.update_service_v1(uuid,text,text,text,integer,numeric,boolean,boolean,integer,uuid,text,text,integer,text)
  to authenticated;

commit;

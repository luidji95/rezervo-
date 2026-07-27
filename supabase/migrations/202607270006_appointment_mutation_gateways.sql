begin;

create or replace function public.assert_owner_manager_appointment_access_v1(p_salon_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_access record;
begin
  if not public.is_salon_owner_or_manager(p_salon_id) then
    raise exception using errcode='P0001',message='FORBIDDEN';
  end if;
  select * into v_access from public.resolve_salon_access_v1(p_salon_id,pg_catalog.now());
  if not coalesce(v_access.has_full_access,false) then
    raise exception using errcode='P0001',message='APPOINTMENT_ACCESS_REQUIRED';
  end if;
end $$;
revoke all on function public.assert_owner_manager_appointment_access_v1(uuid) from public,anon,authenticated;

create or replace function public.create_owner_appointment_atomic_v1(
 p_salon_id uuid,p_service_id uuid,p_employee_id uuid,p_start_time timestamptz,
 p_customer_full_name text,p_customer_phone text,p_customer_email text,
 p_customer_note text,p_idempotency_key uuid)
returns table(appointment_id uuid,was_created boolean,appointment_status public.appointment_status,appointment_start timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_service record;v_relation record;v_existing record;v_client uuid;v_phone text:=nullif(btrim(p_customer_phone),'');v_email text:=nullif(lower(btrim(p_customer_email)),'');v_name text:=btrim(coalesce(p_customer_full_name,''));v_duration int;v_buffer int;v_price numeric;v_end timestamptz;v_id uuid;
begin
 if p_idempotency_key is null or length(v_name)<2 or (v_phone is null and v_email is null) or p_start_time<=pg_catalog.now() then raise exception using errcode='22023',message='INVALID_INPUT'; end if;
 perform public.assert_owner_manager_appointment_access_v1(p_salon_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('owner-appointment:'||p_idempotency_key::text,0));
 select a.* into v_existing from public.appointments a where a.idempotency_key=p_idempotency_key limit 1;
 if found then
  if v_existing.salon_id<>p_salon_id or v_existing.primary_service_id is distinct from p_service_id or v_existing.employee_id is distinct from p_employee_id or v_existing.start_time<>p_start_time then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  return query select v_existing.id,false,v_existing.status,v_existing.start_time;return;
 end if;
 select s.id,s.name,s.duration_minutes,coalesce(s.buffer_minutes,0) buffer_minutes,s.price,s.currency into v_service from public.services s where s.id=p_service_id and s.salon_id=p_salon_id and s.is_active;
 if not found then raise exception using errcode='P0001',message='INVALID_INPUT';end if;
 select es.custom_duration_minutes,es.custom_price into v_relation from public.employee_services es join public.employees e on e.id=es.employee_id and e.salon_id=p_salon_id and e.is_active where es.salon_id=p_salon_id and es.employee_id=p_employee_id and es.service_id=p_service_id and es.is_active;
 if not found then raise exception using errcode='P0001',message='SERVICE_NOT_ASSIGNED';end if;
 v_duration:=coalesce(v_relation.custom_duration_minutes,v_service.duration_minutes);v_buffer:=v_service.buffer_minutes;v_price:=coalesce(v_relation.custom_price,v_service.price);v_end:=p_start_time+pg_catalog.make_interval(mins=>v_duration+v_buffer);
 select c.id into v_client from public.clients c where c.salon_id=p_salon_id and ((v_phone is not null and c.phone=v_phone) or (v_email is not null and lower(c.email)=v_email)) order by c.created_at limit 1;
 if v_client is null then insert into public.clients(salon_id,full_name,phone,email,source) values(p_salon_id,v_name,v_phone,v_email,'manual') returning id into v_client;end if;
 insert into public.appointments(salon_id,client_id,employee_id,primary_service_id,start_time,end_time,duration_minutes,buffer_minutes,price,currency,status,payment_status,booking_source,customer_note,idempotency_key)
 values(p_salon_id,v_client,p_employee_id,p_service_id,p_start_time,v_end,v_duration,v_buffer,v_price,v_service.currency,'pending','unpaid','manual',nullif(btrim(p_customer_note),''),p_idempotency_key) returning id into v_id;
 insert into public.appointment_services(appointment_id,service_id,service_name_snapshot,duration_minutes_snapshot,price_snapshot,sort_order) values(v_id,p_service_id,v_service.name,v_duration,v_price,0);
 return query select v_id,true,'pending'::public.appointment_status,p_start_time;
end $$;

create or replace function public.update_owner_appointment_status_v1(p_appointment_id uuid,p_next_status public.appointment_status,p_cancellation_reason text default null)
returns table(appointment_id uuid,salon_id uuid,previous_status public.appointment_status,new_status public.appointment_status)
language plpgsql security definer set search_path='' as $$
declare v public.appointments%rowtype;
begin
 select a.* into v from public.appointments a where a.id=p_appointment_id for update;
 if not found then raise exception using errcode='P0001',message='APPOINTMENT_NOT_FOUND';end if;
 perform public.assert_owner_manager_appointment_access_v1(v.salon_id);
 if v.status=p_next_status then raise exception using errcode='P0001',message='APPOINTMENT_ALREADY_UPDATED';end if;
 if not ((v.status='pending' and p_next_status in('confirmed','completed','cancelled')) or (v.status='confirmed' and p_next_status in('completed','cancelled','no_show'))) then raise exception using errcode='P0001',message='INVALID_STATUS_TRANSITION';end if;
 update public.appointments a set status=p_next_status,
  confirmed_at=case when p_next_status='confirmed' then pg_catalog.now() else a.confirmed_at end,
  completed_at=case when p_next_status='completed' then pg_catalog.now() else a.completed_at end,
  cancelled_at=case when p_next_status='cancelled' then pg_catalog.now() else a.cancelled_at end,
  cancellation_reason=case when p_next_status='cancelled' then nullif(btrim(p_cancellation_reason),'') else a.cancellation_reason end,
  cancelled_by=case when p_next_status='cancelled' then auth.uid()::text else a.cancelled_by end
 where a.id=v.id and a.status=v.status;
 if not found then raise exception using errcode='P0001',message='APPOINTMENT_ALREADY_UPDATED';end if;
 return query select v.id,v.salon_id,v.status,p_next_status;
end $$;

create or replace function public.reschedule_owner_appointment_v1(p_appointment_id uuid,p_start_time timestamptz,p_employee_id uuid)
returns table(appointment_id uuid,salon_id uuid,appointment_start timestamptz)
language plpgsql security definer set search_path='' as $$
declare v public.appointments%rowtype;v_service record;v_relation record;v_duration int;v_buffer int;v_price numeric;v_end timestamptz;
begin
 select a.* into v from public.appointments a where a.id=p_appointment_id for update;
 if not found then raise exception using errcode='P0001',message='APPOINTMENT_NOT_FOUND';end if;
 perform public.assert_owner_manager_appointment_access_v1(v.salon_id);
 if v.status not in('pending','confirmed') or p_start_time<=pg_catalog.now() then raise exception using errcode='P0001',message='INVALID_INPUT';end if;
 select s.name,s.duration_minutes,coalesce(s.buffer_minutes,0) buffer_minutes,s.price into v_service from public.services s where s.id=v.primary_service_id and s.salon_id=v.salon_id and s.is_active;
 select es.custom_duration_minutes,es.custom_price into v_relation from public.employee_services es join public.employees e on e.id=es.employee_id and e.salon_id=v.salon_id and e.is_active where es.salon_id=v.salon_id and es.employee_id=p_employee_id and es.service_id=v.primary_service_id and es.is_active;
 if not found then raise exception using errcode='P0001',message='SERVICE_NOT_ASSIGNED';end if;
 v_duration:=coalesce(v_relation.custom_duration_minutes,v_service.duration_minutes);v_buffer:=v_service.buffer_minutes;v_price:=coalesce(v_relation.custom_price,v_service.price);v_end:=p_start_time+pg_catalog.make_interval(mins=>v_duration+v_buffer);
 update public.appointments a set employee_id=p_employee_id,start_time=p_start_time,end_time=v_end,duration_minutes=v_duration,buffer_minutes=v_buffer,price=v_price,status='confirmed',confirmed_at=coalesce(a.confirmed_at,pg_catalog.now()),reminder_sent_at=null where a.id=v.id;
 update public.appointment_services aps set duration_minutes_snapshot=v_duration,price_snapshot=v_price,service_name_snapshot=v_service.name where aps.appointment_id=v.id and aps.sort_order=0;
 update public.appointment_reminder_deliveries d set status='cancelled',cancelled_at=pg_catalog.now(),lease_expires_at=null,claim_token=null,last_error_code='APPOINTMENT_RESCHEDULED',last_error_message=null where d.appointment_id=v.id and d.status in('pending','processing','retry_scheduled');
 return query select v.id,v.salon_id,p_start_time;
end $$;

create or replace function public.update_owner_appointment_notes_v1(p_appointment_id uuid,p_internal_note text,p_customer_note text)
returns uuid language plpgsql security definer set search_path='' as $$ declare v_salon uuid;
begin select a.salon_id into v_salon from public.appointments a where a.id=p_appointment_id for update;if not found then raise exception using errcode='P0001',message='APPOINTMENT_NOT_FOUND';end if;perform public.assert_owner_manager_appointment_access_v1(v_salon);update public.appointments set internal_note=nullif(btrim(p_internal_note),''),customer_note=nullif(btrim(p_customer_note),'') where id=p_appointment_id;return p_appointment_id;end $$;

-- Add access gates in front of the existing, already-scoped employee contracts.
alter function public.create_employee_appointment_atomic(uuid,uuid,timestamptz,text,text,text,text,uuid) rename to create_employee_appointment_atomic_scoped_v1;
create function public.create_employee_appointment_atomic(p_profile_id uuid,p_service_id uuid,p_start_time timestamptz,p_customer_full_name text,p_customer_phone text,p_customer_email text,p_customer_note text,p_idempotency_key uuid)
returns table(appointment_id uuid,was_created boolean,appointment_status public.appointment_status,appointment_start timestamptz,salon_id uuid,service_name text,customer_name text)
language plpgsql security definer set search_path='' as $$declare v_salon uuid;v_access record;begin select sm.salon_id into v_salon from public.salon_members sm where sm.profile_id=p_profile_id and sm.role='employee' and sm.status='active' limit 1;if v_salon is null then raise exception using errcode='P0001',message='FORBIDDEN';end if;select * into v_access from public.resolve_salon_access_v1(v_salon,pg_catalog.now());if not coalesce(v_access.has_full_access,false) then raise exception using errcode='P0001',message='APPOINTMENT_ACCESS_REQUIRED';end if;return query select * from public.create_employee_appointment_atomic_scoped_v1(p_profile_id,p_service_id,p_start_time,p_customer_full_name,p_customer_phone,p_customer_email,p_customer_note,p_idempotency_key);end $$;

alter function public.update_employee_appointment_status(uuid,uuid,public.appointment_status) rename to update_employee_appointment_status_scoped_v1;
create function public.update_employee_appointment_status(p_appointment_id uuid,p_profile_id uuid,p_next_status public.appointment_status)
returns table(appointment_id uuid,salon_id uuid,previous_status public.appointment_status,new_status public.appointment_status)
language plpgsql security definer set search_path='' as $$declare v_salon uuid;v_access record;begin select a.salon_id into v_salon from public.appointments a join public.employees e on e.id=a.employee_id where a.id=p_appointment_id and e.profile_id=p_profile_id limit 1;if v_salon is null then raise exception using errcode='P0001',message='APPOINTMENT_NOT_FOUND';end if;select * into v_access from public.resolve_salon_access_v1(v_salon,pg_catalog.now());if not coalesce(v_access.has_full_access,false) then raise exception using errcode='P0001',message='APPOINTMENT_ACCESS_REQUIRED';end if;return query select * from public.update_employee_appointment_status_scoped_v1(p_appointment_id,p_profile_id,p_next_status);end $$;

revoke all on function public.create_employee_appointment_atomic_scoped_v1(uuid,uuid,timestamptz,text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.update_employee_appointment_status_scoped_v1(uuid,uuid,public.appointment_status) from public,anon,authenticated,service_role;
revoke all on function public.create_employee_appointment_atomic(uuid,uuid,timestamptz,text,text,text,text,uuid) from public,anon,authenticated;grant execute on function public.create_employee_appointment_atomic(uuid,uuid,timestamptz,text,text,text,text,uuid) to service_role;
revoke all on function public.update_employee_appointment_status(uuid,uuid,public.appointment_status) from public,anon,authenticated;grant execute on function public.update_employee_appointment_status(uuid,uuid,public.appointment_status) to service_role;

revoke all on function public.create_owner_appointment_atomic_v1(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid) from public,anon;grant execute on function public.create_owner_appointment_atomic_v1(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid) to authenticated,service_role;
revoke all on function public.update_owner_appointment_status_v1(uuid,public.appointment_status,text) from public,anon;grant execute on function public.update_owner_appointment_status_v1(uuid,public.appointment_status,text) to authenticated,service_role;
revoke all on function public.reschedule_owner_appointment_v1(uuid,timestamptz,uuid) from public,anon;grant execute on function public.reschedule_owner_appointment_v1(uuid,timestamptz,uuid) to authenticated,service_role;
revoke all on function public.update_owner_appointment_notes_v1(uuid,text,text) from public,anon;grant execute on function public.update_owner_appointment_notes_v1(uuid,text,text) to authenticated,service_role;
commit;

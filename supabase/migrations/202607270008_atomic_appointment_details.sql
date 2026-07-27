begin;
create or replace function public.update_owner_appointment_details_v1(p_appointment_id uuid,p_client_id uuid,p_full_name text,p_phone text,p_email text,p_internal_note text,p_customer_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_salon uuid;
begin
 select a.salon_id into v_salon from public.appointments a where a.id=p_appointment_id and a.client_id=p_client_id for update;
 if not found then raise exception using errcode='P0001',message='APPOINTMENT_NOT_FOUND';end if;
 perform public.assert_owner_manager_appointment_access_v1(v_salon);
 if length(btrim(coalesce(p_full_name,'')))<2 then raise exception using errcode='22023',message='INVALID_INPUT';end if;
 update public.clients c set full_name=btrim(p_full_name),phone=nullif(btrim(p_phone),''),email=nullif(lower(btrim(p_email)),'') where c.id=p_client_id and c.salon_id=v_salon;
 if not found then raise exception using errcode='P0001',message='APPOINTMENT_NOT_FOUND';end if;
 update public.appointments a set internal_note=nullif(btrim(p_internal_note),''),customer_note=nullif(btrim(p_customer_note),'') where a.id=p_appointment_id;
 return p_appointment_id;
end$$;
revoke all on function public.update_owner_appointment_details_v1(uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.update_owner_appointment_details_v1(uuid,uuid,text,text,text,text,text) to authenticated,service_role;
commit;

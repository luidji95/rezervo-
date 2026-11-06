begin;

-- completed and no_show are outcomes of an appointment that has already happened. Both status gateways
-- (owner/manager and employee) now refuse them before the scheduled end_time, compared with the database
-- clock. Transition rules, cancel, notifications and existing rows are unchanged.

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
 if p_next_status in('completed','no_show') and pg_catalog.now()<v.end_time then raise exception using errcode='P0001',message='APPOINTMENT_NOT_ENDED';end if;
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

-- The scoped employee function locks the row and validates the transition first, so its errors keep precedence.
-- The end check then runs on the locked row; raising rolls back the scoped update in the same statement.
create or replace function public.update_employee_appointment_status(p_appointment_id uuid,p_profile_id uuid,p_next_status public.appointment_status)
returns table(appointment_id uuid,salon_id uuid,previous_status public.appointment_status,new_status public.appointment_status)
language plpgsql security definer set search_path='' as $$
declare v_salon uuid;v_access record;v_result record;v_end timestamptz;
begin
 select a.salon_id into v_salon from public.appointments a join public.employees e on e.id=a.employee_id where a.id=p_appointment_id and e.profile_id=p_profile_id limit 1;
 if v_salon is null then raise exception using errcode='P0001',message='APPOINTMENT_NOT_FOUND';end if;
 select * into v_access from public.resolve_salon_access_v1(v_salon,pg_catalog.now());
 if not coalesce(v_access.has_full_access,false) then raise exception using errcode='P0001',message='APPOINTMENT_ACCESS_REQUIRED';end if;
 select * into v_result from public.update_employee_appointment_status_scoped_v1(p_appointment_id,p_profile_id,p_next_status);
 if p_next_status in('completed','no_show') then
  select a.end_time into v_end from public.appointments a where a.id=p_appointment_id;
  if pg_catalog.now()<v_end then raise exception using errcode='P0001',message='APPOINTMENT_NOT_ENDED';end if;
 end if;
 return query select v_result.appointment_id,v_result.salon_id,v_result.previous_status,v_result.new_status;
end $$;

revoke all on function public.update_owner_appointment_status_v1(uuid,public.appointment_status,text) from public,anon;
grant execute on function public.update_owner_appointment_status_v1(uuid,public.appointment_status,text) to authenticated,service_role;
revoke all on function public.update_employee_appointment_status(uuid,uuid,public.appointment_status) from public,anon,authenticated;
grant execute on function public.update_employee_appointment_status(uuid,uuid,public.appointment_status) to service_role;

commit;

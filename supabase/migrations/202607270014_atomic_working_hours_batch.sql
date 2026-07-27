-- Phase 6D follow-up: one atomic transaction for onboarding working-hour batches.
create or replace function public.sync_working_hours_v1(p_salon_id uuid,p_employee_id uuid,p_hours jsonb)
returns setof public.working_hours language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_seen integer[] := '{}'; v_day integer; v_row public.working_hours;
begin
  perform public.assert_salon_admin_write_access_v1(p_salon_id);
  if not pg_catalog.jsonb_typeof(p_hours)='array' or pg_catalog.jsonb_array_length(p_hours)<1 or pg_catalog.jsonb_array_length(p_hours)>7
  then raise exception using errcode='P0001',message='INVALID_WORKING_HOURS'; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_hours) loop
    v_day := (v_item->>'day_of_week')::integer;
    if v_day=any(v_seen) then raise exception using errcode='P0001',message='INVALID_WORKING_HOURS'; end if;
    v_seen := pg_catalog.array_append(v_seen,v_day);
    select * into v_row from public.upsert_working_hour_v1(
      p_salon_id,p_employee_id,v_day,(v_item->>'opens_at')::time,(v_item->>'closes_at')::time,
      nullif(v_item->>'break_starts_at','')::time,nullif(v_item->>'break_ends_at','')::time,
      coalesce((v_item->>'is_working_day')::boolean,true));
    return next v_row;
  end loop;
end $$;
revoke all on function public.sync_working_hours_v1(uuid,uuid,jsonb) from public,anon;
grant execute on function public.sync_working_hours_v1(uuid,uuid,jsonb) to authenticated,service_role;

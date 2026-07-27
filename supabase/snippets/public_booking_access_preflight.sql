select jsonb_build_object(
  'salons', (select count(*) from public.salons),
  'public_flags_enabled', (select count(*) from public.salons s where s.status='active' and s.booking_enabled and s.online_booking_enabled),
  'public_flags_without_full_access', (
    select count(*) from public.salons s
    cross join lateral public.resolve_employee_capacity_v1(s.id, now()) a
    where s.status='active' and s.booking_enabled and s.online_booking_enabled
      and not a.has_full_access
  ),
  'services', (select count(*) from public.services),
  'employees', (select count(*) from public.employees),
  'clients', (select count(*) from public.clients),
  'appointments', (select count(*) from public.appointments),
  'public_appointments', (select count(*) from public.appointments where booking_source='public'),
  'appointment_statuses', (select coalesce(jsonb_object_agg(status,c), '{}'::jsonb) from (select status::text status,count(*) c from public.appointments group by status) x),
  'notifications', (select count(*) from public.notifications),
  'notification_recipients', (select count(*) from public.notification_recipients),
  'subscriptions', (select count(*) from public.subscriptions),
  'plans', (select count(*) from public.plans),
  'overrides', (select count(*) from public.billing_access_overrides),
  'public_rpc_service_role_only', (
    has_function_privilege('service_role','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')
    and not has_function_privilege('anon','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')
    and not has_function_privilege('authenticated','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')
  )
);

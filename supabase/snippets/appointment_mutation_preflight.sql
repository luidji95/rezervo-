select jsonb_build_object(
 'appointments',(select count(*) from public.appointments),
 'statuses',(select jsonb_object_agg(status,c) from (select status::text status,count(*) c from public.appointments group by status)x),
 'sources',(select jsonb_object_agg(source,c) from (select booking_source::text source,count(*) c from public.appointments group by booking_source)x),
 'snapshots',(select count(*) from public.appointment_services),
 'without_snapshot',(select count(*) from public.appointments a where not exists(select 1 from public.appointment_services aps where aps.appointment_id=a.id)),
 'clients',(select count(*) from public.clients),'notifications',(select count(*) from public.notifications),
 'recipients',(select count(*) from public.notification_recipients),'reminder_deliveries',(select count(*) from public.appointment_reminder_deliveries),
 'subscriptions',(select count(*) from public.subscriptions),'plans',(select count(*) from public.plans),'overrides',(select count(*) from public.billing_access_overrides),
 'employees',(select count(*) from public.employees),'employee_services',(select count(*) from public.employee_services),
 'overlaps',(select count(*) from public.appointments a join public.appointments b on a.id<b.id and a.employee_id=b.employee_id and tstzrange(a.start_time,a.end_time,'[)')&&tstzrange(b.start_time,b.end_time,'[)') where a.status in('pending','confirmed') and b.status in('pending','confirmed'))
);

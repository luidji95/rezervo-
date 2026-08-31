begin;
create or replace function pg_temp.assert_true(v boolean,m text) returns void language plpgsql as $$begin if not coalesce(v,false) then raise exception '%',m;end if;end$$;
create or replace function pg_temp.expect_error(q text,c text) returns void language plpgsql as $$begin execute q;raise exception 'EXPECTED:%',c;exception when others then if sqlerrm='EXPECTED:'||c or position(c in sqlerrm)=0 then raise;end if;end$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('e1000000-0000-4000-8000-000000000001','appointment-owner@example.invalid','{}','{}');
insert into public.salons(id,owner_id,name,slug) values('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Appointment Contract','appointment-contract');
update public.subscriptions set status='active',trial_ends_at=null,billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='b9-appointment-customer',provider_subscription_id='b9-appointment-subscription',current_period_starts_at=now(),current_period_ends_at=now()+interval '30 days',provider_state_updated_at=now() where salon_id='e2000000-0000-4000-8000-000000000001';
insert into public.services(id,salon_id,name,duration_minutes,buffer_minutes,price) values('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Contract Service',30,5,1500);
insert into public.employees(id,salon_id,full_name) values('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Contract Employee');
insert into public.employee_services(salon_id,employee_id,service_id) values('e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');

set local role authenticated;select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select * from public.create_owner_appointment_atomic_v1('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',now()+interval '2 days','Contract Client','+00000000000','', '', 'e5000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),'OWNER_CREATE_FAILED');
select pg_temp.assert_true((select count(*)=1 from public.appointment_services aps join public.appointments a on a.id=aps.appointment_id where a.idempotency_key='e5000000-0000-4000-8000-000000000001'),'SNAPSHOT_FAILED');

select * from public.update_owner_appointment_status_v1((select id from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),'confirmed',null);
select pg_temp.assert_true((select status='confirmed' and confirmed_at is not null from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),'CONFIRM_TIMESTAMP_FAILED');
select * from public.reschedule_owner_appointment_v1((select id from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),now()+interval '3 days','e4000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select reminder_sent_at is null and duration_minutes=30 and buffer_minutes=5 from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),'RESCHEDULE_CONTRACT_FAILED');

reset role;update public.subscriptions set status='expired',current_period_ends_at=now()-interval '1 day' where salon_id='e2000000-0000-4000-8000-000000000001';
create temporary table before_mutation as select (select count(*) from public.clients) clients,(select count(*) from public.appointments) appointments,(select count(*) from public.appointment_services) snapshots,(select count(*) from public.notifications) notifications,(select count(*) from public.notification_recipients) recipients,(select count(*) from public.appointment_reminder_deliveries) reminders,(select row_to_json(a)::text from public.appointments a where idempotency_key='e5000000-0000-4000-8000-000000000001') appointment_row;
set local role authenticated;select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select * from public.create_owner_appointment_atomic_v1('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',now()+interval '4 days','Blocked Client','+00000000001','','','e5000000-0000-4000-8000-000000000002')$q$,'APPOINTMENT_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select * from public.update_owner_appointment_status_v1((select id from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),'completed',null)$q$,'APPOINTMENT_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select * from public.reschedule_owner_appointment_v1((select id from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),now()+interval '5 days','e4000000-0000-4000-8000-000000000001')$q$,'APPOINTMENT_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select public.update_owner_appointment_notes_v1((select id from public.appointments where idempotency_key='e5000000-0000-4000-8000-000000000001'),'blocked','blocked')$q$,'APPOINTMENT_ACCESS_REQUIRED');
select pg_temp.expect_error($q$insert into public.appointments(salon_id,client_id,start_time,end_time,duration_minutes,price) select salon_id,client_id,now()+interval '6 days',now()+interval '6 days 30 minutes',30,1 from public.appointments limit 1$q$,'permission denied');
select pg_temp.expect_error($q$update public.appointments set customer_note='bypass'$q$,'permission denied');
select pg_temp.expect_error($q$delete from public.appointments$q$,'permission denied');
select pg_temp.expect_error($q$insert into public.appointment_services(appointment_id,service_name_snapshot,duration_minutes_snapshot,price_snapshot) select id,'x',1,1 from public.appointments limit 1$q$,'permission denied');
reset role;
select pg_temp.assert_true((select b.clients=(select count(*) from public.clients) and b.appointments=(select count(*) from public.appointments) and b.snapshots=(select count(*) from public.appointment_services) and b.notifications=(select count(*) from public.notifications) and b.recipients=(select count(*) from public.notification_recipients) and b.reminders=(select count(*) from public.appointment_reminder_deliveries) and b.appointment_row=(select row_to_json(a)::text from public.appointments a where idempotency_key='e5000000-0000-4000-8000-000000000001') from before_mutation b),'READ_ONLY_SIDE_EFFECT_DETECTED');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.appointments','insert') and not has_table_privilege('authenticated','public.appointments','update') and not has_table_privilege('authenticated','public.appointments','delete'),'APPOINTMENT_BROWSER_WRITE_REMAINS');
select pg_temp.assert_true(not has_table_privilege('anon','public.appointments','select'),'ANON_APPOINTMENT_READ_REMAINS');
rollback;

begin;
create or replace function pg_temp.assert_true(v boolean,m text) returns void language plpgsql as $$begin if not coalesce(v,false) then raise exception '%',m;end if;end$$;
create or replace function pg_temp.expect_error(q text,c text) returns void language plpgsql as $$begin execute q;raise exception 'EXPECTED:%',c;exception when others then if sqlerrm='EXPECTED:'||c or position(c in sqlerrm)=0 then raise;end if;end$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('f1000000-0000-4000-8000-000000000001','business-owner@example.invalid','{}','{}'),
('f1000000-0000-4000-8000-000000000002','other-owner@example.invalid','{}','{}');
insert into public.salons(id,owner_id,name,slug) values
('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Business Contract','business-contract'),
('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','Other Contract','other-business-contract');
update public.subscriptions set status='active',trial_ends_at=null,current_period_ends_at=now()+interval '30 days'
where salon_id in ('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002');
insert into public.employees(id,salon_id,full_name) values
('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Contract Employee');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select (public.create_service_category_v1('f2000000-0000-4000-8000-000000000001','Hair',null,1)).id;
select (public.create_owner_client_v1('f2000000-0000-4000-8000-000000000001','Contract Client','+381600000000','contract-client@example.invalid','manual')).id;
select (public.create_service_v1('f2000000-0000-4000-8000-000000000001','Contract Service',null,'Hair',30,1500,true,true,5,null,null,null,1)).id;
select public.sync_employee_service_assignments_v1(
  'f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',
  array[(select id from public.services where salon_id='f2000000-0000-4000-8000-000000000001')]::uuid[]
);
select pg_temp.assert_true((select count(*)=1 from public.employee_services where employee_id='f3000000-0000-4000-8000-000000000001' and is_active),'ASSIGNMENT_SYNC_FAILED');
select (public.update_service_v1((select id from public.services where salon_id='f2000000-0000-4000-8000-000000000001'),'Contract Service Updated',null,'Hair',45,1700,true,true)).id;
select pg_temp.assert_true((select buffer_minutes=5 and sort_order=1 from public.services where salon_id='f2000000-0000-4000-8000-000000000001'),'SERVICE_OMITTED_FIELDS_WERE_RESET');
select pg_temp.expect_error($q$select public.sync_employee_service_assignments_v1('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',array[(select id from public.services where salon_id='f2000000-0000-4000-8000-000000000001'),(select id from public.services where salon_id='f2000000-0000-4000-8000-000000000001')]::uuid[])$q$,'INVALID_INPUT');
select pg_temp.expect_error($q$select (public.create_owner_client_v1('f2000000-0000-4000-8000-000000000002','Cross Tenant',null,null,'manual')).id$q$,'FORBIDDEN');
reset role;

create temporary table before_block as select
  (select count(*) from public.clients) clients,
  (select count(*) from public.services) services,
  (select count(*) from public.service_categories) categories,
  (select count(*) from public.employee_services) assignments,
  (select count(*) from public.appointments) appointments,
  (select count(*) from public.appointment_services) snapshots,
  (select count(*) from public.notifications) notifications,
  (select count(*) from public.appointment_reminder_deliveries) reminders;
update public.subscriptions set status='expired',current_period_ends_at=now()-interval '1 day'
where salon_id='f2000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select (public.create_owner_client_v1('f2000000-0000-4000-8000-000000000001','Blocked Client',null,null,'manual')).id$q$,'SALON_WRITE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select (public.update_owner_client_v1((select id from public.clients where salon_id='f2000000-0000-4000-8000-000000000001'),'Blocked Update',null,null,'manual',null)).id$q$,'SALON_WRITE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select (public.create_service_v1('f2000000-0000-4000-8000-000000000001','Blocked Service',null,null,30,1,true,true,0,null,null,null,0)).id$q$,'SALON_WRITE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select (public.create_service_category_v1('f2000000-0000-4000-8000-000000000001','Blocked Category',null,0)).id$q$,'SALON_WRITE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select public.sync_employee_service_assignments_v1('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','{}'::uuid[])$q$,'SALON_WRITE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$insert into public.clients(salon_id,full_name) values('f2000000-0000-4000-8000-000000000001','Bypass')$q$,'permission denied');
select pg_temp.expect_error($q$update public.services set price=0 where salon_id='f2000000-0000-4000-8000-000000000001'$q$,'permission denied');
select pg_temp.expect_error($q$delete from public.service_categories where salon_id='f2000000-0000-4000-8000-000000000001'$q$,'permission denied');
select pg_temp.expect_error($q$insert into public.employee_services(salon_id,employee_id,service_id) select 'f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',id from public.services where salon_id='f2000000-0000-4000-8000-000000000001'$q$,'permission denied');
reset role;
select pg_temp.assert_true((select b.clients=(select count(*) from public.clients) and b.services=(select count(*) from public.services) and b.categories=(select count(*) from public.service_categories) and b.assignments=(select count(*) from public.employee_services) and b.appointments=(select count(*) from public.appointments) and b.snapshots=(select count(*) from public.appointment_services) and b.notifications=(select count(*) from public.notifications) and b.reminders=(select count(*) from public.appointment_reminder_deliveries) from before_block b),'READ_ONLY_SIDE_EFFECT_DETECTED');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.clients','insert') and not has_table_privilege('authenticated','public.clients','update') and not has_table_privilege('authenticated','public.clients','delete')
  and not has_table_privilege('authenticated','public.services','insert') and not has_table_privilege('authenticated','public.services','update') and not has_table_privilege('authenticated','public.services','delete')
  and not has_table_privilege('authenticated','public.service_categories','insert') and not has_table_privilege('authenticated','public.service_categories','update') and not has_table_privilege('authenticated','public.service_categories','delete')
  and not has_table_privilege('authenticated','public.employee_services','insert') and not has_table_privilege('authenticated','public.employee_services','update') and not has_table_privilege('authenticated','public.employee_services','delete'),
  'DIRECT_WRITE_GRANT_REMAINS');
rollback;

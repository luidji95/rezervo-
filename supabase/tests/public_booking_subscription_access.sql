-- Run only on a disposable database after 202607270005.
begin;

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$ begin if not coalesce(p_value,false) then raise exception '%',p_message; end if; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text)
returns void language plpgsql as $$ begin execute p_sql; raise exception 'EXPECTED_ERROR_NOT_RAISED:%',p_code;
exception when others then if sqlerrm='EXPECTED_ERROR_NOT_RAISED:'||p_code or position(p_code in sqlerrm)=0 then raise; end if; end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('d1000000-0000-4000-8000-000000000001','booking-owner@example.invalid','{}','{}'),
 ('d1000000-0000-4000-8000-000000000002','booking-expired-owner@example.invalid','{}','{}'),
 ('d1000000-0000-4000-8000-000000000003','booking-override-owner@example.invalid','{}','{}'),
 ('d1000000-0000-4000-8000-000000000004','booking-disabled-owner@example.invalid','{}','{}');
insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Booking Full','booking-full',true,true),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002','Booking Expired','booking-expired',true,true),
 ('d2000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000003','Booking Override','booking-override',true,true),
 ('d2000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000004','Booking Disabled','booking-disabled',false,true);

update public.subscriptions set status='trialing',trial_ends_at=now()+interval '1 day' where salon_id='d2000000-0000-4000-8000-000000000001';
update public.subscriptions set status='expired',trial_ends_at=now()-interval '1 day' where salon_id in ('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003');
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason)
select 'd2000000-0000-4000-8000-000000000003',id,'internal','public booking contract test' from public.plans where slug='premium';

-- Canonical lifecycle boundaries use one fixed instant.
do $$
declare v_now timestamptz := '2030-01-01 12:00:00+00'; v_access boolean;
begin
  update public.subscriptions set status='trialing',trial_ends_at=v_now where salon_id='d2000000-0000-4000-8000-000000000004';
  select has_full_access into v_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000004',v_now);
  if v_access then raise exception 'TRIAL_EQUAL_NOW_MUST_BE_READ_ONLY'; end if;
  update public.subscriptions set trial_ends_at=null where salon_id='d2000000-0000-4000-8000-000000000004';
  select has_full_access into v_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000004',v_now);
  if v_access then raise exception 'NULL_TRIAL_END_MUST_BE_READ_ONLY'; end if;
  update public.subscriptions set status='active',billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id='b9-public-customer-disabled',provider_subscription_id='b9-public-subscription-disabled',
    current_period_starts_at=v_now-interval '1 day',current_period_ends_at=v_now+interval '1 day',provider_state_updated_at=v_now
  where salon_id='d2000000-0000-4000-8000-000000000004';
  select has_full_access into v_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000004',v_now);
  if not v_access then raise exception 'ACTIVE_FUTURE_MUST_BE_FULL'; end if;
  update public.subscriptions set current_period_ends_at=v_now where salon_id='d2000000-0000-4000-8000-000000000004';
  select has_full_access into v_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000004',v_now);
  if v_access then raise exception 'ACTIVE_EQUAL_NOW_MUST_BE_READ_ONLY'; end if;
  update public.subscriptions set status='cancelled',current_period_ends_at=v_now+interval '1 day' where salon_id='d2000000-0000-4000-8000-000000000004';
  select has_full_access into v_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000004',v_now);
  if not v_access then raise exception 'CANCELLED_FUTURE_MUST_BE_FULL'; end if;
  update public.subscriptions set current_period_ends_at=v_now where salon_id='d2000000-0000-4000-8000-000000000004';
  select has_full_access into v_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000004',v_now);
  if v_access then raise exception 'CANCELLED_EQUAL_NOW_MUST_BE_READ_ONLY'; end if;
  update public.subscriptions set status='past_due' where salon_id='d2000000-0000-4000-8000-000000000004';
  select has_full_access into v_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000004',v_now);
  if v_access then raise exception 'PAST_DUE_MUST_BE_READ_ONLY'; end if;
  update public.subscriptions set status='expired' where salon_id='d2000000-0000-4000-8000-000000000004';
end $$;

select pg_temp.assert_true((select has_full_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000001',now())),'ACTIVE_TRIAL_NOT_FULL');
select pg_temp.assert_true(not (select has_full_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000002',now())),'EXPIRED_NOT_READ_ONLY');
select pg_temp.assert_true((select has_full_access and effective_plan_slug='premium' from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000003',now())),'OVERRIDE_NOT_FULL');
select pg_temp.assert_true((select c.has_full_access=a.has_full_access and c.access_reason=a.access_reason from public.resolve_employee_capacity_v1('d2000000-0000-4000-8000-000000000003',now()) c cross join public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000003',now()) a),'EMPLOYEE_ACCESS_PARITY_FAILED');
update public.billing_access_overrides set starts_at=now()+interval '1 day' where salon_id='d2000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(not (select has_full_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000003',now())),'SCHEDULED_OVERRIDE_MUST_BE_IGNORED');
update public.billing_access_overrides set starts_at=now()-interval '1 day',ends_at=now() where salon_id='d2000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(not (select has_full_access from public.resolve_salon_access_v1('d2000000-0000-4000-8000-000000000003',now())),'OVERRIDE_END_EQUAL_NOW_MUST_BE_IGNORED');
update public.billing_access_overrides set ends_at=null where salon_id='d2000000-0000-4000-8000-000000000003';

insert into public.services(id,salon_id,name,duration_minutes,price) values
 ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Test Service',30,1000),
 ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002','Test Service',30,1000);
insert into public.employees(id,salon_id,full_name) values
 ('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Test Employee');
-- Temporarily restore access only to build the expired-salon fixture.
update public.subscriptions set status='active',billing_provider='lemonsqueezy',billing_environment='test',
 provider_customer_id='b9-public-customer-expired',provider_subscription_id='b9-public-subscription-expired',
 current_period_starts_at=now(),current_period_ends_at=now()+interval '1 day',provider_state_updated_at=now()
where salon_id='d2000000-0000-4000-8000-000000000002';
insert into public.employees(id,salon_id,full_name) values
 ('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002','Test Employee');
update public.subscriptions set status='expired',current_period_ends_at=now()-interval '1 day' where salon_id='d2000000-0000-4000-8000-000000000002';
insert into public.employee_services(salon_id,employee_id,service_id) values
 ('d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001'),
 ('d2000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002');

select * from public.create_public_booking_atomic('booking-full','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001',now()+interval '2 days','Test Client','+381600000001','', 'd5000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.appointments where idempotency_key='d5000000-0000-4000-8000-000000000001'),'BOOKING_NOT_CREATED');

-- A successful idempotent replay remains available after access expires.
update public.subscriptions set trial_ends_at=now()-interval '1 second' where salon_id='d2000000-0000-4000-8000-000000000001';
select * from public.create_public_booking_atomic('booking-full','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001',now()+interval '2 days','Test Client','+381600000001','', 'd5000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.appointments where idempotency_key='d5000000-0000-4000-8000-000000000001'),'IDEMPOTENT_REPLAY_DUPLICATED');

create temporary table before_counts as select
 (select count(*) from public.clients) clients,
 (select count(*) from public.appointments) appointments,
 (select count(*) from public.appointment_services) snapshots,
 (select count(*) from public.notifications) notifications,
 (select count(*) from public.notification_recipients) recipients;
select pg_temp.expect_error($q$select * from public.create_public_booking_atomic('booking-expired','d3000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000002',now()+interval '3 days','Blocked Client','+381600000002','', 'd5000000-0000-4000-8000-000000000002')$q$,'PUBLIC_BOOKING_UNAVAILABLE');
select pg_temp.assert_true((select b.clients=(select count(*) from public.clients) and b.appointments=(select count(*) from public.appointments) and b.snapshots=(select count(*) from public.appointment_services) and b.notifications=(select count(*) from public.notifications) and b.recipients=(select count(*) from public.notification_recipients) from before_counts b),'REJECTED_BOOKING_CREATED_SIDE_EFFECTS');

select pg_temp.assert_true(not has_table_privilege('anon','public.services','select'),'ANON_SERVICES_SELECT_REMAINS');
select pg_temp.assert_true(not has_table_privilege('anon','public.employees','select'),'ANON_EMPLOYEES_SELECT_REMAINS');
select pg_temp.assert_true(not has_function_privilege('anon','public.resolve_salon_access_v1(uuid,timestamptz)','execute'),'ANON_ACCESS_RESOLVER_EXECUTE_REMAINS');

rollback;

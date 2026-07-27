begin;
create or replace function pg_temp.assert_true(v boolean,m text) returns void language plpgsql as $$begin if not coalesce(v,false) then raise exception '%',m;end if;end$$;
create or replace function pg_temp.expect_error(q text,c text) returns void language plpgsql as $$begin execute q;raise exception 'EXPECTED:%',c;exception when others then if sqlerrm='EXPECTED:'||c or position(c in sqlerrm)=0 then raise;end if;end$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('71000000-0000-4000-8000-000000000001','bootstrap-one@example.invalid','{}','{}'),
('71000000-0000-4000-8000-000000000002','bootstrap-two@example.invalid','{}','{}'),
('71000000-0000-4000-8000-000000000003','bootstrap-three@example.invalid','{}','{}'),
('71000000-0000-4000-8000-000000000004','bootstrap-four@example.invalid','{}','{}');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
create temporary table first_result as select * from public.create_primary_salon_once_v1('Bootstrap Salon','bootstrap-salon','barbershop',null,null,null,null,null,null);
select pg_temp.assert_true((select was_created from first_result),'FIRST_CALL_NOT_CREATED');
select pg_temp.assert_true((select count(*)=1 from public.salons s where s.owner_id='71000000-0000-4000-8000-000000000001'),'SALON_COUNT_INVALID');
select pg_temp.assert_true((select count(*)=1 from public.salon_members sm join first_result r on r.salon_id=sm.salon_id where sm.profile_id='71000000-0000-4000-8000-000000000001' and sm.role='owner' and sm.status='active'),'OWNER_MEMBERSHIP_INVALID');
select pg_temp.assert_true((select count(*)=1 and bool_and(sub.status='trialing' and sub.billing_provider is null and sub.provider_customer_id is null and sub.provider_subscription_id is null and sub.trial_ends_at between sub.trial_starts_at+interval '14 days'-interval '1 second' and sub.trial_starts_at+interval '14 days'+interval '1 second') from public.subscriptions sub join first_result r on r.salon_id=sub.salon_id),'TRIAL_CONTRACT_INVALID');
create temporary table retry_before as select sub.trial_starts_at,sub.trial_ends_at,sub.plan_id from public.subscriptions sub join first_result r on r.salon_id=sub.salon_id;
create temporary table retry_result as select * from public.create_primary_salon_once_v1('Different retry payload','other-slug','beauty_salon',null,null,null,null,null,null);
select pg_temp.assert_true((select not was_created and salon_id=(select salon_id from first_result) from retry_result),'RETRY_NOT_IDEMPOTENT');
select pg_temp.assert_true((select rb.trial_starts_at=sub.trial_starts_at and rb.trial_ends_at=sub.trial_ends_at and rb.plan_id=sub.plan_id from retry_before rb join public.subscriptions sub on true join first_result r on r.salon_id=sub.salon_id),'RETRY_CHANGED_TRIAL');
reset role;
select pg_temp.expect_error($q$insert into public.salons(owner_id,name,slug) values('71000000-0000-4000-8000-000000000001','Second','second-owner-salon')$q$,'duplicate key');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select * from public.create_primary_salon_once_v1('Slug Collision','bootstrap-salon','barbershop',null,null,null,null,null,null);
select pg_temp.assert_true((select slug='bootstrap-salon-2' from public.salons where owner_id='71000000-0000-4000-8000-000000000002'),'SLUG_SUFFIX_NOT_APPLIED');
reset role;

delete from public.salon_members where profile_id='71000000-0000-4000-8000-000000000002';
set local role authenticated;select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select * from public.create_primary_salon_once_v1('Ignored','ignored','barbershop',null,null,null,null,null,null);
select pg_temp.assert_true((select count(*)=1 from public.salon_members sm join public.salons s on s.id=sm.salon_id where s.owner_id='71000000-0000-4000-8000-000000000002' and sm.role='owner' and sm.status='active'),'MISSING_MEMBERSHIP_NOT_HEALED');
reset role;
update public.salon_members set status='inactive' where profile_id='71000000-0000-4000-8000-000000000002' and role='owner';
set local role authenticated;select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select * from public.create_primary_salon_once_v1('Ignored','ignored','barbershop',null,null,null,null,null,null)$q$,'OWNER_MEMBERSHIP_CONFLICT');
reset role;

set local role authenticated;select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select * from public.create_primary_salon_once_v1('No auth','no-auth','barbershop',null,null,null,null,null,null)$q$,'UNAUTHORIZED');reset role;

create function public.bootstrap_test_fail_membership() returns trigger language plpgsql as $$begin if new.profile_id='71000000-0000-4000-8000-000000000003' then raise exception 'TEST_MEMBERSHIP_FAILURE';end if;return new;end$$;
create trigger bootstrap_test_membership before insert on public.salon_members for each row execute function public.bootstrap_test_fail_membership();
set local role authenticated;select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select * from public.create_primary_salon_once_v1('Membership fail','membership-fail','barbershop',null,null,null,null,null,null)$q$,'TEST_MEMBERSHIP_FAILURE');reset role;
select pg_temp.assert_true(not exists(select 1 from public.salons where owner_id='71000000-0000-4000-8000-000000000003'),'MEMBERSHIP_FAILURE_LEFT_SALON');
drop trigger bootstrap_test_membership on public.salon_members;drop function public.bootstrap_test_fail_membership();

create function public.bootstrap_test_fail_trial() returns trigger language plpgsql as $$begin if exists(select 1 from public.salons s where s.id=new.salon_id and s.owner_id='71000000-0000-4000-8000-000000000004') then raise exception 'TEST_TRIAL_FAILURE';end if;return new;end$$;
create trigger bootstrap_test_trial before insert on public.subscriptions for each row execute function public.bootstrap_test_fail_trial();
set local role authenticated;select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_error($q$select * from public.create_primary_salon_once_v1('Trial fail','trial-fail','barbershop',null,null,null,null,null,null)$q$,'TEST_TRIAL_FAILURE');reset role;
select pg_temp.assert_true(not exists(select 1 from public.salons where owner_id='71000000-0000-4000-8000-000000000004'),'TRIAL_FAILURE_LEFT_SALON');
select pg_temp.assert_true(has_table_privilege('service_role','public.salons','insert') and has_table_privilege('service_role','public.salon_members','insert'),'SERVICE_ROLE_ACCESS_BROKEN');
set local role authenticated;select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$insert into public.salons(owner_id,name,slug) values('71000000-0000-4000-8000-000000000001','Bypass','bypass-salon')$q$,'permission denied');
select pg_temp.expect_error($q$insert into public.salon_members(salon_id,profile_id,role,status) select salon_id,'71000000-0000-4000-8000-000000000001','owner','active' from first_result$q$,'permission denied');
rollback;

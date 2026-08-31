-- Run only on a disposable database after 202607270004.
begin;

create or replace function pg_temp.expect_error(p_sql text, p_code text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED:%', p_code;
exception when others then
  if sqlerrm = 'EXPECTED_ERROR_NOT_RAISED:' || p_code or position(p_code in sqlerrm) = 0 then raise; end if;
end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','cap-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000002','cap-manager@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000003','cap-employee@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000004','cap-other@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000005','invitee@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000006','cap-pro-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000007','cap-expired-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000008','cap-cancel-future-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000009','cap-cancel-past-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000010','cap-legacy-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000011','cap-override-pro-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000012','cap-override-premium-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000013','cap-missing-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000014','cap-past-due-owner@example.invalid','{}','{}'),
 ('a1000000-0000-4000-8000-000000000015','cap-disabled-override-owner@example.invalid','{}','{}');

insert into public.salons(id,owner_id,name,slug) values
 ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Starter Capacity','cap-starter'),
 ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000006','Pro Capacity','cap-pro'),
 ('b1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000007','Expired Capacity','cap-expired'),
 ('b1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000008','Cancelled Future','cap-cancel-future'),
 ('b1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000009','Cancelled Past','cap-cancel-past'),
 ('b1000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000010','Legacy Capacity','cap-legacy'),
 ('b1000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000011','Override Pro','cap-override-pro'),
 ('b1000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000012','Override Premium','cap-override-premium'),
 ('b1000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000013','Missing Contract','cap-missing'),
 ('b1000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000004','Other Salon','cap-other'),
 ('b1000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000014','Past Due','cap-past-due'),
 ('b1000000-0000-4000-8000-000000000012','a1000000-0000-4000-8000-000000000015','Disabled Override','cap-disabled-override');

insert into public.salon_members(salon_id,profile_id,role,status) values
 ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','manager','active'),
 ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','employee','active');

update public.subscriptions set plan_id=(select id from public.plans where slug='starter'),status='active',trial_starts_at=null,trial_ends_at=null,billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='b9-capacity-customer-starter',provider_subscription_id='b9-capacity-subscription-starter',current_period_starts_at=now(),current_period_ends_at=now()+interval '30 days',provider_state_updated_at=now() where salon_id='b1000000-0000-4000-8000-000000000001';
update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='b9-capacity-customer-pro',provider_subscription_id='b9-capacity-subscription-pro',current_period_starts_at=now(),current_period_ends_at=now()+interval '30 days',provider_state_updated_at=now() where salon_id='b1000000-0000-4000-8000-000000000002';
update public.subscriptions set status='trialing',trial_ends_at=now()-interval '1 day' where salon_id='b1000000-0000-4000-8000-000000000003';
update public.subscriptions set status='expired',trial_ends_at=now()-interval '1 day' where salon_id in ('b1000000-0000-4000-8000-000000000007','b1000000-0000-4000-8000-000000000008','b1000000-0000-4000-8000-000000000012');
update public.subscriptions set status='cancelled',billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='b9-capacity-customer-cancel-future',provider_subscription_id='b9-capacity-subscription-cancel-future',current_period_ends_at=now()+interval '1 day' where salon_id='b1000000-0000-4000-8000-000000000004';
update public.subscriptions set status='cancelled',billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='b9-capacity-customer-cancel-past',provider_subscription_id='b9-capacity-subscription-cancel-past',current_period_ends_at=now()-interval '1 day' where salon_id='b1000000-0000-4000-8000-000000000005';
update public.subscriptions set status='active',current_period_ends_at=null where salon_id='b1000000-0000-4000-8000-000000000006';
update public.subscriptions set status='past_due' where salon_id='b1000000-0000-4000-8000-000000000011';
delete from public.subscriptions where salon_id='b1000000-0000-4000-8000-000000000009';
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason)
select 'b1000000-0000-4000-8000-000000000007',id,'internal','capacity test' from public.plans where slug='pro';
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason)
select 'b1000000-0000-4000-8000-000000000008',id,'internal','capacity test' from public.plans where slug='premium';
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,enabled)
select 'b1000000-0000-4000-8000-000000000012',id,'internal','capacity test',false from public.plans where slug='pro';

-- Starter: inactive does not count; third active succeeds and fourth fails.
insert into public.employees(salon_id,full_name,is_active) values
 ('b1000000-0000-4000-8000-000000000001','Starter One',true),
 ('b1000000-0000-4000-8000-000000000001','Starter Two',true),
 ('b1000000-0000-4000-8000-000000000001','Starter Inactive',false),
 ('b1000000-0000-4000-8000-000000000001','Starter Three',true);
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000001','Starter Four')$q$,'EMPLOYEE_LIMIT_REACHED');
select pg_temp.expect_error($q$update public.employees set is_active=true where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter Inactive'$q$,'EMPLOYEE_LIMIT_REACHED');
update public.employees set full_name='Starter One Renamed' where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter One';
update public.employees set is_active=false where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter Three';
update public.employees set is_active=true where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter Inactive';

-- Pro and lifecycle matrix.
insert into public.employees(salon_id,full_name)
select 'b1000000-0000-4000-8000-000000000002','Pro '||g from generate_series(1,10) g;
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000002','Pro Eleven')$q$,'EMPLOYEE_LIMIT_REACHED');
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000003','Expired')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000011','Past Due')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000012','Disabled Override')$q$,'EMPLOYEE_ACCESS_REQUIRED');
insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000004','Cancelled Future');
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000005','Cancelled Past')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000006','Legacy')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000009','Missing')$q$,'EMPLOYEE_ENTITLEMENT_NOT_CONFIGURED');
insert into public.employees(salon_id,full_name)
select 'b1000000-0000-4000-8000-000000000007','Override Pro '||g from generate_series(1,10) g;
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000007','Override Pro Eleven')$q$,'EMPLOYEE_LIMIT_REACHED');
insert into public.employees(salon_id,full_name)
select 'b1000000-0000-4000-8000-000000000008','Override Premium '||g from generate_series(1,25) g;
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000008','Override Premium Twenty Six')$q$,'EMPLOYEE_LIMIT_REACHED');

-- Linking an already-active employee does not consume another slot; invitation remains compatible.
update public.employees set profile_id='a1000000-0000-4000-8000-000000000001'
where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter One Renamed';
insert into public.team_invitations(salon_id,employee_id,invited_by,email)
select e.salon_id,e.id,'a1000000-0000-4000-8000-000000000001','invitee@example.invalid'
from public.employees e where e.salon_id='b1000000-0000-4000-8000-000000000001' and e.full_name='Starter Two';
create temporary table invitation_capacity_before as
select count(*)::integer as active_count
from public.employees
where salon_id='b1000000-0000-4000-8000-000000000001' and is_active=true;
select * from public.accept_team_invitation(
  (select id from public.team_invitations where email='invitee@example.invalid'),
  'a1000000-0000-4000-8000-000000000005'
);
do $$ declare v_already boolean; begin
  select already_accepted into v_already from public.accept_team_invitation(
    (select id from public.team_invitations where email='invitee@example.invalid'),
    'a1000000-0000-4000-8000-000000000005'
  );
  if not v_already then raise exception 'INVITATION_IDEMPOTENCY_FAILED'; end if;
end $$;
do $$ begin
  if (select active_count from invitation_capacity_before) is distinct from (
    select count(*)::integer from public.employees
    where salon_id='b1000000-0000-4000-8000-000000000001' and is_active=true
  ) then raise exception 'INVITATION_CHANGED_ACTIVE_EMPLOYEE_COUNT'; end if;
end $$;

-- Browser bypasses are denied; authorized RPC remains tenant-scoped.
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select public.update_employee_details_v1(
  (select id from public.employees where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter One Renamed'),
  'Starter One RPC',null,null,null,null,null,true,true
);
select public.set_employee_active_state(
  (select id from public.employees where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter One RPC'), false
);
select public.set_employee_active_state(
  (select id from public.employees where salon_id='b1000000-0000-4000-8000-000000000001' and full_name='Starter One RPC'), true
);
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name,is_active) values ('b1000000-0000-4000-8000-000000000001','Direct Insert',false)$q$,'permission denied');
select pg_temp.expect_error($q$update public.employees set is_active=false where salon_id='b1000000-0000-4000-8000-000000000001'$q$,'permission denied');
select pg_temp.expect_error($q$update public.employees set profile_id=null where salon_id='b1000000-0000-4000-8000-000000000001'$q$,'permission denied');
select pg_temp.expect_error($q$delete from public.employees where salon_id='b1000000-0000-4000-8000-000000000001'$q$,'permission denied');
select pg_temp.expect_error($q$select public.create_employee_with_entitlement('b1000000-0000-4000-8000-000000000010','Cross Tenant',null,null,null,null,null)$q$,'FORBIDDEN');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.create_employee_with_entitlement('b1000000-0000-4000-8000-000000000001','Employee Creates Peer',null,null,null,null,null)$q$,'FORBIDDEN');
reset role;

-- Historical over-limit rows are retained; only the next activation is blocked.
alter table public.employees disable trigger enforce_employee_capacity_v1;
insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000001','Historical Over Limit');
alter table public.employees enable trigger enforce_employee_capacity_v1;
select pg_temp.expect_error($q$insert into public.employees(salon_id,full_name) values ('b1000000-0000-4000-8000-000000000001','Blocked After Historical Over Limit')$q$,'EMPLOYEE_LIMIT_REACHED');

rollback;

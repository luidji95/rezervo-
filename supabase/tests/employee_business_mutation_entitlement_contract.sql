-- Run only on a disposable database after 202607290027.
begin;

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_value, false) then raise exception '%', p_message; end if;
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_code text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED:%', p_code;
exception when others then
  if sqlerrm = 'EXPECTED_ERROR_NOT_RAISED:' || p_code
     or position(p_code in sqlerrm) = 0 then raise; end if;
end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select ('c1000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
       'employee-mutation-' || g || '@example.invalid','{}','{}'
from generate_series(1,9) g;

insert into public.salons(id,owner_id,name,slug)
select ('c2000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
       ('c1000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
       'Employee mutation ' || g, 'employee-mutation-' || g
from generate_series(1,9) g;

-- Employees are created while every trigger-created subscription is an active trial.
insert into public.employees(id,salon_id,full_name,is_active,is_bookable,is_public)
select ('c3000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
       ('c2000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
       'Original ' || g, true, true, true
from generate_series(1,9) g;

-- Real relationship fixtures. Employee 6 becomes read-only later. Salon 2
-- retains one historical employee for soft delete and one future-booked employee.
insert into public.employees(id,salon_id,full_name,is_active,is_bookable,is_public) values
  ('c3100000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002','Historical Employee',true,true,true),
  ('c3100000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','Future Employee',true,true,true);
insert into public.services(id,salon_id,name,duration_minutes,price) values
  ('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','Active Relation Service',30,1000),
  ('c4000000-0000-4000-8000-000000000006','c2000000-0000-4000-8000-000000000006','Read Only Relation Service',30,1000);
insert into public.clients(id,salon_id,full_name) values
  ('c5000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','Active Relation Client'),
  ('c5000000-0000-4000-8000-000000000006','c2000000-0000-4000-8000-000000000006','Read Only Relation Client');
insert into public.employee_services(salon_id,employee_id,service_id) values
  ('c2000000-0000-4000-8000-000000000002','c3100000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000002'),
  ('c2000000-0000-4000-8000-000000000006','c3000000-0000-4000-8000-000000000006','c4000000-0000-4000-8000-000000000006');
insert into public.appointments(
  id,salon_id,client_id,employee_id,primary_service_id,start_time,end_time,
  duration_minutes,price,status,completed_at,idempotency_key
) values
  ('c6000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002','c3100000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000002',pg_catalog.now()-interval '10 days',pg_catalog.now()-interval '10 days'+interval '30 minutes',30,1000,'completed',pg_catalog.now()-interval '9 days','c7000000-0000-4000-8000-000000000001'),
  ('c6000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002','c3100000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000002',pg_catalog.now()+interval '10 days',pg_catalog.now()+interval '10 days 30 minutes',30,1000,'pending',null,'c7000000-0000-4000-8000-000000000002'),
  ('c6000000-0000-4000-8000-000000000006','c2000000-0000-4000-8000-000000000006','c5000000-0000-4000-8000-000000000006','c3000000-0000-4000-8000-000000000006','c4000000-0000-4000-8000-000000000006',pg_catalog.now()-interval '20 days',pg_catalog.now()-interval '20 days'+interval '30 minutes',30,1000,'completed',pg_catalog.now()-interval '19 days','c7000000-0000-4000-8000-000000000006');

-- 1 active trial; 2 active; 3 cancelled grace; 4 override; 5 expired trial;
-- 6 past_due (also the local representation of provider unpaid); 7 expired;
-- 8 cancelled after period end; 9 missing subscription.
update public.subscriptions set status='active', trial_starts_at=null, trial_ends_at=null,
  current_period_ends_at=pg_catalog.now()+interval '30 days'
where salon_id='c2000000-0000-4000-8000-000000000002';
update public.subscriptions set status='cancelled', current_period_ends_at=pg_catalog.now()+interval '1 day'
where salon_id='c2000000-0000-4000-8000-000000000003';
update public.subscriptions set status='expired', trial_ends_at=pg_catalog.now()-interval '1 day'
where salon_id='c2000000-0000-4000-8000-000000000004';
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,ends_at)
select 'c2000000-0000-4000-8000-000000000004',p.id,'support','employee mutation contract',pg_catalog.now()+interval '1 day'
from public.plans p where p.slug='pro';
update public.subscriptions set status='trialing', trial_ends_at=pg_catalog.now()-interval '1 day'
where salon_id='c2000000-0000-4000-8000-000000000005';
update public.subscriptions set status='past_due'
where salon_id='c2000000-0000-4000-8000-000000000006';
update public.subscriptions set status='expired', current_period_ends_at=pg_catalog.now()-interval '1 day'
where salon_id='c2000000-0000-4000-8000-000000000007';
update public.subscriptions set status='cancelled', current_period_ends_at=pg_catalog.now()-interval '1 day'
where salon_id='c2000000-0000-4000-8000-000000000008';
delete from public.subscriptions where salon_id='c2000000-0000-4000-8000-000000000009';

set local role authenticated;

-- Full-access update matrix.
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000001','Trial Updated',null,null,null,null,null,true,true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000002','Active Updated',null,null,null,null,null,true,true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000003','Cancelled Grace Updated',null,null,null,null,null,true,true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000004','Override Updated',null,null,null,null,null,true,true);

-- Every full-access lifecycle performs a real deactivate and reactivate.
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000001',false);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000002',false);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000003',false);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000004',false);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000004',true);

-- Rejected update matrix and atomic no-side-effect proof.
reset role;
create temporary table rejected_before as
select e.id, row_to_json(e)::text employee_row,
  coalesce((select jsonb_agg(to_jsonb(a) order by a.id)::text from public.appointments a where a.employee_id=e.id),'[]') appointment_rows,
  coalesce((select jsonb_agg(to_jsonb(es) order by es.service_id)::text from public.employee_services es where es.employee_id=e.id),'[]') service_rows
from public.employees e where e.id in (
  'c3000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000006',
  'c3000000-0000-4000-8000-000000000007','c3000000-0000-4000-8000-000000000008',
  'c3000000-0000-4000-8000-000000000009'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000005',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000005',true);
select pg_temp.expect_error($q$select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000005','Rejected',null,null,null,null,null,false,false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select public.set_employee_active_state('c3000000-0000-4000-8000-000000000005',false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000006',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000006',true);
select pg_temp.expect_error($q$select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000006','Rejected',null,null,null,null,null,false,false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select public.set_employee_active_state('c3000000-0000-4000-8000-000000000006',false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000007',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000007',true);
select pg_temp.expect_error($q$select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000007','Rejected',null,null,null,null,null,false,false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select public.set_employee_active_state('c3000000-0000-4000-8000-000000000007',false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000008',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000008',true);
select pg_temp.expect_error($q$select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000008','Rejected',null,null,null,null,null,false,false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select public.set_employee_active_state('c3000000-0000-4000-8000-000000000008',false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000009',true);
select public.set_employee_active_state('c3000000-0000-4000-8000-000000000009',true);
select pg_temp.expect_error($q$select public.update_employee_details_v1('c3000000-0000-4000-8000-000000000009','Rejected',null,null,null,null,null,false,false)$q$,'EMPLOYEE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select public.set_employee_active_state('c3000000-0000-4000-8000-000000000009',false)$q$,'EMPLOYEE_ACCESS_REQUIRED');

reset role;
select pg_temp.assert_true(not exists (
  select 1 from rejected_before b join public.employees e on e.id=b.id
  where b.employee_row is distinct from row_to_json(e)::text
     or b.appointment_rows is distinct from coalesce((select jsonb_agg(to_jsonb(a) order by a.id)::text from public.appointments a where a.employee_id=e.id),'[]')
     or b.service_rows is distinct from coalesce((select jsonb_agg(to_jsonb(es) order by es.service_id)::text from public.employee_services es where es.employee_id=e.id),'[]')
),'REJECTED_UPDATE_SIDE_EFFECT');

select pg_temp.assert_true((select appointment_rows <> '[]' and service_rows <> '[]' from rejected_before where id='c3000000-0000-4000-8000-000000000006'),'READ_ONLY_REAL_RELATION_FIXTURE_MISSING');

-- Full-access hard deletes succeed.
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000001')='hard','TRIAL_DELETE_FAILED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000002')='hard','ACTIVE_DELETE_FAILED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000003')='hard','CANCELLED_GRACE_DELETE_FAILED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
select pg_temp.assert_true(public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000004')='hard','OVERRIDE_DELETE_FAILED');

-- Full-access soft delete preserves historical appointment content.
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
create temporary table historical_appointment_before as
select row_to_json(a)::text appointment_row from public.appointments a where a.id='c6000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.delete_employee_safely_v1('c3100000-0000-4000-8000-000000000001')='soft','HISTORICAL_SOFT_DELETE_FAILED');
reset role;
select pg_temp.assert_true((select not is_active and not is_bookable and not is_public from public.employees where id='c3100000-0000-4000-8000-000000000001'),'SOFT_DELETE_STATE_INVALID');
select pg_temp.assert_true((select appointment_row from historical_appointment_before)=(select row_to_json(a)::text from public.appointments a where a.id='c6000000-0000-4000-8000-000000000001'),'SOFT_DELETE_CHANGED_HISTORY');

-- A future pending appointment retains the pre-existing safety error atomically.
create temporary table future_employee_before as select row_to_json(e)::text employee_row from public.employees e where e.id='c3100000-0000-4000-8000-000000000002';
create temporary table future_appointment_before as select row_to_json(a)::text appointment_row from public.appointments a where a.id='c6000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.delete_employee_safely_v1('c3100000-0000-4000-8000-000000000002')$q$,'EMPLOYEE_HAS_FUTURE_APPOINTMENTS');
reset role;
select pg_temp.assert_true((select employee_row from future_employee_before)=(select row_to_json(e)::text from public.employees e where e.id='c3100000-0000-4000-8000-000000000002'),'FUTURE_APPOINTMENT_REJECTION_CHANGED_EMPLOYEE');
select pg_temp.assert_true((select appointment_row from future_appointment_before)=(select row_to_json(a)::text from public.appointments a where a.id='c6000000-0000-4000-8000-000000000002'),'FUTURE_APPOINTMENT_REJECTION_CHANGED_APPOINTMENT');

-- Rejected delete/deactivate leaves employee and all relation counts unchanged.
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000005',true);
select pg_temp.expect_error($q$select public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000005')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000006',true);
select pg_temp.expect_error($q$select public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000006')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000007',true);
select pg_temp.expect_error($q$select public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000007')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000008',true);
select pg_temp.expect_error($q$select public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000008')$q$,'EMPLOYEE_ACCESS_REQUIRED');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000009',true);
select pg_temp.expect_error($q$select public.delete_employee_safely_v1('c3000000-0000-4000-8000-000000000009')$q$,'EMPLOYEE_ACCESS_REQUIRED');
reset role;

select pg_temp.assert_true(not exists (
  select 1 from rejected_before b left join public.employees e on e.id=b.id
  where e.id is null or b.employee_row is distinct from row_to_json(e)::text
     or b.appointment_rows is distinct from coalesce((select jsonb_agg(to_jsonb(a) order by a.id)::text from public.appointments a where a.employee_id=b.id),'[]')
     or b.service_rows is distinct from coalesce((select jsonb_agg(to_jsonb(es) order by es.service_id)::text from public.employee_services es where es.employee_id=b.id),'[]')
),'REJECTED_DELETE_SIDE_EFFECT');

-- Metadata/grant audit: browser DML remains denied and both mutation RPCs use the canonical resolver.
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.employees','insert')
  and not has_table_privilege('authenticated','public.employees','update')
  and not has_table_privilege('authenticated','public.employees','delete'),
  'AUTHENTICATED_EMPLOYEE_DML_ALLOWED'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated','public.update_employee_details_v1(uuid,text,text,text,text,text,text,boolean,boolean)','execute')
  and has_function_privilege('authenticated','public.delete_employee_safely_v1(uuid)','execute'),
  'EMPLOYEE_RPC_GRANT_BROKEN'
);

-- Runtime RPC dependency used by the notification route: one required named
-- UUID input, one defaulted timestamptz input, SETOF record/table output, and
-- a boolean has_full_access column. Calling with p_salon_id alone must work.
select pg_temp.assert_true(to_regprocedure('public.resolve_salon_access_v1(uuid,timestamptz)') is not null,'ACCESS_RESOLVER_SIGNATURE_MISSING');
select pg_temp.assert_true((
  select p.pronargdefaults=1 and p.proretset and p.prorettype='record'::regtype
    and p.proargnames[1:2]=array['p_salon_id','p_now']::text[]
    and pg_get_expr(p.proargdefaults,0) like '%now()%'
  from pg_proc p where p.oid='public.resolve_salon_access_v1(uuid,timestamptz)'::regprocedure
),'ACCESS_RESOLVER_DEFAULT_OR_TABLE_CONTRACT_INVALID');
select pg_temp.assert_true((
  select count(*)=1 and bool_and(pg_typeof(r.has_full_access)='boolean'::regtype)
  from public.resolve_salon_access_v1('c2000000-0000-4000-8000-000000000002') r
),'ACCESS_RESOLVER_SINGLE_ARGUMENT_RPC_SHAPE_INVALID');
select pg_temp.assert_true(
  pg_get_functiondef('public.update_employee_details_v1(uuid,text,text,text,text,text,text,boolean,boolean)'::regprocedure)
    like '%public.resolve_salon_access_v1%'
  and pg_get_functiondef('public.delete_employee_safely_v1(uuid)'::regprocedure)
    like '%public.resolve_salon_access_v1%'
  and pg_get_functiondef('public.set_employee_active_state(uuid,boolean)'::regprocedure)
    like '%public.resolve_salon_access_v1%',
  'CANONICAL_EMPLOYEE_ACCESS_CHECK_MISSING'
);
select pg_temp.assert_true((
  select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='update_employee_details_v1'
),'ALTERNATE_EMPLOYEE_UPDATE_OVERLOAD_FOUND');
select pg_temp.assert_true((
  select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='delete_employee_safely_v1'
),'ALTERNATE_EMPLOYEE_DELETE_OVERLOAD_FOUND');
select pg_temp.assert_true((
  select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_employee_active_state'
),'ALTERNATE_EMPLOYEE_ACTIVE_STATE_OVERLOAD_FOUND');

rollback;

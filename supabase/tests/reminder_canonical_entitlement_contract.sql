-- Run only on a disposable database after 202607290028.
begin;

create or replace function pg_temp.assert_true(p_value boolean,p_message text)
returns void language plpgsql as $$begin if not coalesce(p_value,false) then raise exception '%',p_message; end if; end$$;

do $$
declare g integer;
begin
  for g in 1..15 loop
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values (('91000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      'reminder-entitlement-'||g||'@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
    values (('92000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      ('91000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      'Reminder Entitlement '||g,'reminder-entitlement-'||g);
    insert into public.clients(id,salon_id,full_name,phone)
    values (('93000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      ('92000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      'Reminder Client '||g,'+38164123'||lpad(g::text,3,'0'));
    insert into public.salon_reminder_settings(salon_id,enabled,channel,hours_before)
    values (('92000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,true,'sms',24);
    insert into public.appointments(
      id,salon_id,client_id,start_time,end_time,duration_minutes,price,status,idempotency_key
    ) values (
      ('94000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      ('92000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      ('93000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      '2026-08-02T12:00:00Z','2026-08-02T12:30:00Z',30,1000,'pending',
      ('95000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid
    );
  end loop;
end $$;

-- 1 trial Pro; 2 active Pro; 3 cancelled grace; 4 expired + active Pro override.
update public.subscriptions set status='trialing',trial_ends_at='2026-08-10T12:00:00Z'
where salon_id='92000000-0000-4000-8000-000000000001';
update public.subscriptions set status='active',trial_ends_at=null,
 current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-09-01T00:00:00Z'
where salon_id='92000000-0000-4000-8000-000000000002';
update public.subscriptions set status='cancelled',trial_ends_at=null,
 current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-09-01T00:00:00Z'
where salon_id='92000000-0000-4000-8000-000000000003';
update public.subscriptions set status='expired',trial_ends_at=null,current_period_ends_at='2026-07-01T00:00:00Z'
where salon_id='92000000-0000-4000-8000-000000000004';
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at,ends_at)
select '92000000-0000-4000-8000-000000000004',id,'support','reminder parity','2026-07-01T00:00:00Z','2026-09-01T00:00:00Z'
from public.plans where slug='pro';

-- Denied lifecycle and override/capability fixtures.
update public.subscriptions set status='trialing',trial_ends_at='2026-08-01T11:59:59Z'
where salon_id='92000000-0000-4000-8000-000000000005';
update public.subscriptions set status='past_due'
where salon_id='92000000-0000-4000-8000-000000000006';
update public.subscriptions set status='expired'
where salon_id='92000000-0000-4000-8000-000000000007';
update public.subscriptions set status='cancelled',current_period_ends_at='2026-08-01T12:00:00Z'
where salon_id='92000000-0000-4000-8000-000000000008';
delete from public.subscriptions where salon_id='92000000-0000-4000-8000-000000000009';
update public.subscriptions set status='expired' where salon_id in (
 '92000000-0000-4000-8000-000000000010','92000000-0000-4000-8000-000000000011',
 '92000000-0000-4000-8000-000000000013'
);
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,enabled,starts_at,ends_at)
select '92000000-0000-4000-8000-000000000010',id,'support','disabled override',false,'2026-07-01T00:00:00Z','2026-09-01T00:00:00Z' from public.plans where slug='pro';
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at,ends_at)
select '92000000-0000-4000-8000-000000000011',id,'support','boundary override','2026-07-01T00:00:00Z','2026-08-01T12:00:00Z' from public.plans where slug='pro';
update public.subscriptions set status='active',plan_id=(select id from public.plans where slug='starter'),
 trial_ends_at=null,current_period_ends_at='2026-09-01T00:00:00Z'
where salon_id='92000000-0000-4000-8000-000000000012';
insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at,ends_at)
select '92000000-0000-4000-8000-000000000013',id,'support','starter override','2026-07-01T00:00:00Z','2026-09-01T00:00:00Z' from public.plans where slug='starter';
update public.subscriptions set status='active',trial_ends_at=null,current_period_ends_at='2026-08-01T12:00:00Z'
where salon_id='92000000-0000-4000-8000-000000000014';

-- A finite fixture quota makes send-time reservation boundaries observable.
update public.plans set max_monthly_reminders=2 where slug='pro';

-- Structurally corrupt missing-plan fixture: the FK change is transaction-local
-- and exists only to prove the resolver's fail-closed plan_missing branch.
alter table public.subscriptions drop constraint subscriptions_plan_id_fkey;
update public.subscriptions set plan_id='99000000-0000-4000-8000-000000000015'
where salon_id='92000000-0000-4000-8000-000000000015';

create temporary table business_before as
select s.id, row_to_json(sub)::text subscription_row,
  coalesce((select jsonb_agg(to_jsonb(o) order by o.id)::text from public.billing_access_overrides o where o.salon_id=s.id),'[]') override_rows
from public.salons s left join public.subscriptions sub on sub.salon_id=s.id
where s.slug like 'reminder-entitlement-%';

-- Preview and usage follow canonical access and the effective plan.
select pg_temp.assert_true((select eligible and reason='ELIGIBLE' from public.preview_due_appointment_reminders(
  '92000000-0000-4000-8000-000000000003',50,'2026-08-01T12:00:00Z')),'CANCELLED_GRACE_PREVIEW_INVALID');
select pg_temp.assert_true((select eligible and reason='ELIGIBLE' from public.preview_due_appointment_reminders(
  '92000000-0000-4000-8000-000000000004',50,'2026-08-01T12:00:00Z')),'PRO_OVERRIDE_PREVIEW_INVALID');
select pg_temp.assert_true((select not eligible and reason='ENTITLEMENT_REQUIRED' from public.preview_due_appointment_reminders(
  '92000000-0000-4000-8000-000000000012',50,'2026-08-01T12:00:00Z')),'STARTER_PREVIEW_CAPABILITY_INVALID');
select pg_temp.assert_true((select not eligible and reason='ENTITLEMENT_REQUIRED' from public.preview_due_appointment_reminders(
  '92000000-0000-4000-8000-000000000006',50,'2026-08-01T12:00:00Z')),'PAST_DUE_PREVIEW_INVALID');
select pg_temp.assert_true((select not eligible and reason='ENTITLEMENT_REQUIRED' from public.preview_due_appointment_reminders(
  '92000000-0000-4000-8000-000000000007',50,'2026-08-01T12:00:00Z')),'EXPIRED_PREVIEW_INVALID');
select pg_temp.assert_true((select max_monthly_reminders=0 from public.get_salon_reminder_usage(
  '92000000-0000-4000-8000-000000000013','2026-08-01T12:00:00Z')),'USAGE_DID_NOT_USE_STARTER_OVERRIDE_PLAN');
select pg_temp.assert_true((select max_monthly_reminders=2 from public.get_salon_reminder_usage(
  '92000000-0000-4000-8000-000000000004','2026-08-01T12:00:00Z')),'USAGE_DID_NOT_USE_PRO_OVERRIDE_PLAN');

create temporary table claimed as
select * from public.claim_due_appointment_reminders(50,'2026-08-01T12:00:00Z',10);

select pg_temp.assert_true((select count(*)=4 from claimed),'CANONICAL_ELIGIBLE_CLAIM_COUNT_INVALID');
select pg_temp.assert_true(not exists(
  select 1 from claimed where salon_id not in (
    '92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000004'
  )
),'READ_ONLY_OR_CAPABILITY_DENIED_REMINDER_CLAIMED');
select pg_temp.assert_true(not exists(
  select 1 from public.appointment_reminder_deliveries d
  where d.salon_id in (
    '92000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000006',
    '92000000-0000-4000-8000-000000000007','92000000-0000-4000-8000-000000000008',
    '92000000-0000-4000-8000-000000000009','92000000-0000-4000-8000-000000000010',
    '92000000-0000-4000-8000-000000000011','92000000-0000-4000-8000-000000000012',
    '92000000-0000-4000-8000-000000000013','92000000-0000-4000-8000-000000000014',
    '92000000-0000-4000-8000-000000000015'
  )
),'DENIED_REMINDER_SIDE_EFFECT');

-- Exact scheduling boundary is eligible; an active lease prevents duplicate claim.
select pg_temp.assert_true(not exists(
  select 1 from public.claim_due_appointment_reminders(50,'2026-08-01T12:00:00Z',10)
),'DUPLICATE_ACTIVE_LEASE_CLAIMED');

-- Send-time quota counts only processing reservations in the canonical usage
-- period. One accepted reminder plus the delivery being validated exactly fills
-- the limit; previous/future-period leases must not consume it.
insert into public.appointments(id,salon_id,client_id,start_time,end_time,duration_minutes,price,status,idempotency_key)
values
 ('94100000-0000-4000-8000-000000000031','92000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003','2026-06-15T12:00:00Z','2026-06-15T12:30:00Z',30,1000,'pending','95100000-0000-4000-8000-000000000031'),
 ('94100000-0000-4000-8000-000000000032','92000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003','2026-09-15T12:00:00Z','2026-09-15T12:30:00Z',30,1000,'pending','95100000-0000-4000-8000-000000000032'),
 ('94100000-0000-4000-8000-000000000033','92000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003','2026-08-10T12:00:00Z','2026-08-10T12:30:00Z',30,1000,'pending','95100000-0000-4000-8000-000000000033'),
 ('94100000-0000-4000-8000-000000000034','92000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003','2026-08-11T12:00:00Z','2026-08-11T12:30:00Z',30,1000,'pending','95100000-0000-4000-8000-000000000034');
insert into public.appointment_reminder_deliveries(
 id,salon_id,appointment_id,client_id,channel,scheduled_for,appointment_start_snapshot,
 recipient_snapshot,salon_timezone_snapshot,status,attempt_count,claimed_at,lease_expires_at,claim_token,
 provider,provider_message_id,sent_at
) values
 ('96100000-0000-4000-8000-000000000031','92000000-0000-4000-8000-000000000003','94100000-0000-4000-8000-000000000031','93000000-0000-4000-8000-000000000003','sms','2026-06-14T12:00:00Z','2026-06-15T12:00:00Z','+38164123003','Europe/Belgrade','processing',1,'2026-08-01T12:00:00Z','2026-08-01T12:10:00Z','97100000-0000-4000-8000-000000000031',null,null,null),
 ('96100000-0000-4000-8000-000000000032','92000000-0000-4000-8000-000000000003','94100000-0000-4000-8000-000000000032','93000000-0000-4000-8000-000000000003','sms','2026-09-14T12:00:00Z','2026-09-15T12:00:00Z','+38164123003','Europe/Belgrade','processing',1,'2026-08-01T12:00:00Z','2026-08-01T12:10:00Z','97100000-0000-4000-8000-000000000032',null,null,null),
 ('96100000-0000-4000-8000-000000000033','92000000-0000-4000-8000-000000000003','94100000-0000-4000-8000-000000000033','93000000-0000-4000-8000-000000000003','sms','2026-08-09T12:00:00Z','2026-08-10T12:00:00Z','+38164123003','Europe/Belgrade','sent',1,null,null,null,'fixture','fixture-current-used','2026-08-01T11:00:00Z');

select pg_temp.assert_true((select is_valid and reason='ELIGIBLE' from public.validate_claimed_reminder_for_send(
  (select delivery_id from claimed where salon_id='92000000-0000-4000-8000-000000000003'),
  (select claim_token from claimed where salon_id='92000000-0000-4000-8000-000000000003'),'2026-08-01T12:00:01Z')),
  'CROSS_PERIOD_PROCESSING_LEASE_BLOCKED_LAST_FREE_SLOT');

insert into public.appointment_reminder_deliveries(
 id,salon_id,appointment_id,client_id,channel,scheduled_for,appointment_start_snapshot,
 recipient_snapshot,salon_timezone_snapshot,status,attempt_count,claimed_at,lease_expires_at,claim_token
) values (
 '96100000-0000-4000-8000-000000000034','92000000-0000-4000-8000-000000000003','94100000-0000-4000-8000-000000000034','93000000-0000-4000-8000-000000000003','sms','2026-08-10T12:00:00Z','2026-08-11T12:00:00Z','+38164123003','Europe/Belgrade','processing',1,'2026-08-01T12:00:00Z','2026-08-01T12:10:00Z','97100000-0000-4000-8000-000000000034'
);
create temporary table quota_denied as
select * from public.validate_claimed_reminder_for_send(
  (select delivery_id from claimed where salon_id='92000000-0000-4000-8000-000000000003'),
  (select claim_token from claimed where salon_id='92000000-0000-4000-8000-000000000003'),'2026-08-01T12:00:02Z');
select pg_temp.assert_true((select not is_valid and reason='QUOTA_EXHAUSTED' and recipient is null from quota_denied),
  'CURRENT_PERIOD_QUOTA_OR_RECIPIENT_REDACTION_INVALID');

-- Send-time revalidation: access loss after claim cancels before provider input
-- can be returned, while keeping the truthful attempt audit.
update public.subscriptions set status='past_due'
where salon_id='92000000-0000-4000-8000-000000000002';
create temporary table revalidated_denied as
select * from public.validate_claimed_reminder_for_send(
  (select delivery_id from claimed where salon_id='92000000-0000-4000-8000-000000000002'),
  (select claim_token from claimed where salon_id='92000000-0000-4000-8000-000000000002'),
  '2026-08-01T12:00:01Z'
);
select pg_temp.assert_true((select not is_valid and reason='ENTITLEMENT_REQUIRED' and recipient is null from revalidated_denied),'SEND_TIME_ACCESS_REVALIDATION_FAILED');
select pg_temp.assert_true((select status='cancelled' and attempt_count=1 and sent_at is null and provider_message_id is null
  from public.appointment_reminder_deliveries where salon_id='92000000-0000-4000-8000-000000000002'),'SEND_TIME_DENIAL_AUDIT_INVALID');

-- Active Pro override remains valid at send-time.
select pg_temp.assert_true((select is_valid and reason='ELIGIBLE' from public.validate_claimed_reminder_for_send(
  (select delivery_id from claimed where salon_id='92000000-0000-4000-8000-000000000004'),
  (select claim_token from claimed where salon_id='92000000-0000-4000-8000-000000000004'),'2026-08-01T12:00:01Z')),'OVERRIDE_SEND_VALIDATION_FAILED');

-- Lease is strict: equality is expired and cannot expose recipient data.
create temporary table lease_boundary as
select * from public.validate_claimed_reminder_for_send(
  (select delivery_id from claimed where salon_id='92000000-0000-4000-8000-000000000001'),
  (select claim_token from claimed where salon_id='92000000-0000-4000-8000-000000000001'),
  '2026-08-01T12:10:00Z'
);
select pg_temp.assert_true((select not is_valid and reason='CLAIM_EXPIRED' and recipient is null from lease_boundary),'LEASE_BOUNDARY_INVALID');

-- Only the deliberate send-time lifecycle change differs; claim/validation never
-- writes provider ownership, plan or other subscription metadata.
select pg_temp.assert_true(not exists(
  select 1 from business_before b join public.subscriptions sub on sub.salon_id=b.id
  where b.id<>'92000000-0000-4000-8000-000000000002'
    and b.subscription_row is distinct from row_to_json(sub)::text
),'REMINDER_CHANGED_SUBSCRIPTION_DATA');
select pg_temp.assert_true(not exists(
  select 1 from business_before b
  where b.override_rows is distinct from coalesce((select jsonb_agg(to_jsonb(o) order by o.id)::text from public.billing_access_overrides o where o.salon_id=b.id),'[]')
),'REMINDER_CHANGED_OVERRIDE_DATA');

-- All four replaced RPCs retain their exact signatures/default counts, table
-- return shapes, definer/search-path hardening, canonical resolver dependency,
-- and service-role-only execution contract.
do $$
declare
  v_signature text;
  v_expected_defaults integer;
  v_expected_result text;
  v_proc pg_catalog.pg_proc%rowtype;
begin
  for v_signature,v_expected_defaults,v_expected_result in values
    ('public.get_salon_reminder_usage(uuid,timestamptz)',1,
      'TABLE(salon_id uuid, period_start timestamp with time zone, period_end timestamp with time zone, accepted_count bigint, max_monthly_reminders integer, remaining integer)'),
    ('public.preview_due_appointment_reminders(uuid,integer,timestamptz)',3,
      'TABLE(salon_id uuid, appointment_id uuid, scheduled_for timestamp with time zone, eligible boolean, reason text, recipient_masked text, salon_timezone text)'),
    ('public.claim_due_appointment_reminders(integer,timestamptz,integer)',3,
      'TABLE(delivery_id uuid, salon_id uuid, appointment_id uuid, client_id uuid, channel reminder_channel, scheduled_for timestamp with time zone, appointment_start timestamp with time zone, recipient text, salon_timezone text, attempt_count integer, lease_expires_at timestamp with time zone, claim_token uuid)'),
    ('public.validate_claimed_reminder_for_send(uuid,uuid,timestamptz)',1,
      'TABLE(is_valid boolean, reason text, delivery_id uuid, salon_id uuid, appointment_id uuid, recipient text, appointment_start timestamp with time zone, salon_timezone text, salon_name text, service_name text, attempt_count integer, max_attempts integer)')
  loop
    select p.* into v_proc from pg_catalog.pg_proc p where p.oid=v_signature::regprocedure;
    perform pg_temp.assert_true(v_proc.oid is not null,v_signature||':MISSING');
    perform pg_temp.assert_true(v_proc.prosecdef,v_signature||':NOT_SECURITY_DEFINER');
    perform pg_temp.assert_true(v_proc.proconfig=array['search_path=""'],v_signature||':SEARCH_PATH_INVALID');
    perform pg_temp.assert_true(v_proc.pronargdefaults=v_expected_defaults,v_signature||':DEFAULTS_CHANGED');
    perform pg_temp.assert_true(pg_catalog.pg_get_function_result(v_proc.oid)=v_expected_result,v_signature||':RETURN_TYPE_CHANGED');
    perform pg_temp.assert_true(pg_catalog.pg_get_functiondef(v_proc.oid) like '%public.resolve_salon_access_v1%',v_signature||':CANONICAL_RESOLVER_MISSING');
    perform pg_temp.assert_true(not exists(
      select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE'
    ),v_signature||':PUBLIC_EXECUTE_ALLOWED');
    perform pg_temp.assert_true(not pg_catalog.has_function_privilege('anon',v_signature,'execute'),v_signature||':ANON_EXECUTE_ALLOWED');
    perform pg_temp.assert_true(not pg_catalog.has_function_privilege('authenticated',v_signature,'execute'),v_signature||':AUTHENTICATED_EXECUTE_ALLOWED');
    perform pg_temp.assert_true(pg_catalog.has_function_privilege('service_role',v_signature,'execute'),v_signature||':SERVICE_ROLE_EXECUTE_MISSING');
  end loop;
end $$;

select pg_temp.assert_true(
  pg_get_functiondef('public.claim_due_appointment_reminders(integer,timestamptz,integer)'::regprocedure) not like '%subscription.status%'
  and pg_get_functiondef('public.validate_claimed_reminder_for_send(uuid,uuid,timestamptz)'::regprocedure) not like '%subscription_status%',
  'REMINDER_LIFECYCLE_COPY_REINTRODUCED'
);

rollback;

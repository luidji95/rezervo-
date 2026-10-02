-- Run only on a disposable database after migration 202607290029.
begin;

create or replace function pg_temp.assert_true(p_value boolean,p_message text)
returns void language plpgsql as $$begin if not coalesce(p_value,false) then raise exception '%',p_message; end if; end$$;

create or replace function pg_temp.expect_check(p_sql text,p_message text)
returns void language plpgsql as $$
begin
  begin execute p_sql; exception when check_violation then return; end;
  raise exception '%',p_message;
end $$;

do $$
declare g integer;
begin
  for g in 1..8 loop
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values (('a9100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      'provider-period-'||g||'@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
    values (('a9200000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      ('a9100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      'Provider Period '||g,'provider-period-'||g);
  end loop;
end $$;

-- Historical provider-null legacy and a normal trial remain valid.
update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,
  current_period_starts_at=null,current_period_ends_at=null
where salon_id='a9200000-0000-4000-8000-000000000001';
update public.subscriptions set status='trialing',
  trial_starts_at='2026-07-01T00:00:00Z',trial_ends_at='2026-08-01T00:00:00Z'
where salon_id='a9200000-0000-4000-8000-000000000002';

-- Valid test/live active provider rows satisfy the same invariant.
update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,
  billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer-test',provider_subscription_id='subscription-test',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
where salon_id='a9200000-0000-4000-8000-000000000003';
update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,
  billing_provider='lemonsqueezy',billing_environment='live',
  provider_customer_id='customer-live',provider_subscription_id='subscription-live',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
where salon_id='a9200000-0000-4000-8000-000000000004';

-- Non-active provider lifecycle rows retain their existing lifecycle contract.
update public.subscriptions set status='cancelled',trial_starts_at=null,trial_ends_at=null,
  billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer-cancelled',provider_subscription_id='subscription-cancelled',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
where salon_id='a9200000-0000-4000-8000-000000000005';
update public.subscriptions set status='past_due',trial_starts_at=null,trial_ends_at=null,
  billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer-past-due',provider_subscription_id='subscription-past-due',
  provider_state_updated_at='2026-07-01T00:01:00Z'
where salon_id='a9200000-0000-4000-8000-000000000006';
update public.subscriptions set status='expired',trial_starts_at=null,trial_ends_at=null,
  billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer-expired',provider_subscription_id='subscription-expired',
  provider_state_updated_at='2026-07-01T00:01:00Z'
where salon_id='a9200000-0000-4000-8000-000000000007';

create temporary table subscription_before as
select subscription.id,row_to_json(subscription)::text as row_value
from public.subscriptions as subscription
join public.salons as salon on salon.id=subscription.salon_id
where salon.slug like 'provider-period-%';

select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer',provider_subscription_id='subscription',
  current_period_starts_at=null,current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_NULL_START_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer',provider_subscription_id='subscription',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at=null,
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_NULL_END_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer',provider_subscription_id='subscription',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at=null
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_NULL_STATE_TIMESTAMP_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id=null,provider_subscription_id='subscription',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_NULL_CUSTOMER_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer',provider_subscription_id=null,
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_NULL_SUBSCRIPTION_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='',provider_subscription_id='123456',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_EMPTY_CUSTOMER_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='   ',provider_subscription_id='123456',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_WHITESPACE_CUSTOMER_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='654321',provider_subscription_id='',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_EMPTY_SUBSCRIPTION_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='654321',provider_subscription_id=E'\t\n',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_WHITESPACE_SUBSCRIPTION_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer',provider_subscription_id='subscription',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-07-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_EQUAL_PERIOD_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  status='active',billing_provider='lemonsqueezy',billing_environment='test',
  provider_customer_id='customer',provider_subscription_id='subscription',
  current_period_starts_at='2026-08-01T00:00:00Z',current_period_ends_at='2026-07-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000008'$sql$,'PROVIDER_ACTIVE_REVERSED_PERIOD_ALLOWED');

-- A legacy row cannot be provider-linked in a partial first update.
select pg_temp.expect_check($sql$update public.subscriptions set
  billing_provider='lemonsqueezy',billing_environment='live',
  provider_customer_id='partial-customer',provider_subscription_id='partial-subscription'
  where salon_id='a9200000-0000-4000-8000-000000000001'$sql$,'PARTIAL_LIVE_PROVIDER_LINK_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  billing_provider='lemonsqueezy',billing_environment='live',
  provider_customer_id='   ',provider_subscription_id=E'\t',
  current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
  provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='a9200000-0000-4000-8000-000000000001'$sql$,'LEGACY_WHITESPACE_PROVIDER_LINK_ALLOWED');

-- Existing environment consistency remains authoritative; processor contracts
-- separately reject a test event against any live-linked subscription.
select pg_temp.expect_check($sql$update public.subscriptions set
  billing_environment=null where salon_id='a9200000-0000-4000-8000-000000000003'$sql$,'PROVIDER_WITHOUT_ENVIRONMENT_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  billing_environment='production' where salon_id='a9200000-0000-4000-8000-000000000003'$sql$,'UNKNOWN_ENVIRONMENT_ALLOWED');
select pg_temp.expect_check($sql$update public.subscriptions set
  billing_provider=null where salon_id='a9200000-0000-4000-8000-000000000003'$sql$,'PROVIDER_ENVIRONMENT_MISMATCH_ALLOWED');

select pg_temp.assert_true(not exists(
  select 1 from subscription_before before_row
  join public.subscriptions subscription on subscription.id=before_row.id
  where before_row.row_value is distinct from row_to_json(subscription)::text
),'REJECTED_UPDATE_LEFT_PARTIAL_SUBSCRIPTION_STATE');

select pg_temp.assert_true((
  select has_full_access and access_reason='legacy_active_no_period' and is_legacy_active
  from public.resolve_salon_access_v1('a9200000-0000-4000-8000-000000000001','2026-07-15T00:00:00Z')
),'PROVIDER_NULL_LEGACY_ACCESS_CHANGED');
select pg_temp.assert_true((
  select has_full_access and access_reason='active_trial' and not is_legacy_active
  from public.resolve_salon_access_v1('a9200000-0000-4000-8000-000000000002','2026-07-15T00:00:00Z')
),'ACTIVE_TRIAL_ACCESS_CHANGED');
select pg_temp.assert_true((
  select has_full_access and access_reason='active_period' and not is_legacy_active
  from public.resolve_salon_access_v1('a9200000-0000-4000-8000-000000000003','2026-07-15T00:00:00Z')
),'VALID_PROVIDER_ACTIVE_ACCESS_INVALID');

select pg_temp.assert_true((select convalidated from pg_catalog.pg_constraint
  where conrelid='public.subscriptions'::regclass
    and conname='subscriptions_provider_active_period_consistent'),
  'PROVIDER_ACTIVE_PERIOD_CONSTRAINT_MISSING_OR_NOT_VALIDATED');
select pg_temp.assert_true((select pg_catalog.pg_get_constraintdef(oid) like '%provider_state_updated_at IS NOT NULL%'
  and pg_catalog.pg_get_constraintdef(oid) like '%current_period_ends_at > current_period_starts_at%'
  and (length(pg_catalog.pg_get_constraintdef(oid))-length(replace(pg_catalog.pg_get_constraintdef(oid),'[^[:space:]]','')))/length('[^[:space:]]')=2
  from pg_catalog.pg_constraint where conrelid='public.subscriptions'::regclass
    and conname='subscriptions_provider_active_period_consistent'),
  'PROVIDER_ACTIVE_PERIOD_CONSTRAINT_DEFINITION_INVALID');
select pg_temp.assert_true((select count(*)=1 from pg_catalog.pg_constraint
  where conrelid='public.subscriptions'::regclass
    and conname='subscriptions_provider_active_period_consistent'),
  'PROVIDER_ACTIVE_PERIOD_CONSTRAINT_DUPLICATED');

select pg_temp.assert_true((select pg_catalog.pg_get_constraintdef(oid) like '%provider_subscription_id ~ ''[^[:space:]]''%'
  from pg_catalog.pg_constraint
  where conrelid='public.billing_webhook_subscription_facts'::regclass
    and conname='billing_webhook_subscription_facts_subscription_id_check'),
  'FACTS_BLANK_SUBSCRIPTION_ID_GUARD_MISSING');
select pg_temp.assert_true(
  pg_catalog.pg_get_functiondef('public.process_billing_subscription_created_v1(uuid,timestamptz)'::regprocedure)
    like '%provider_subscription_id%[^[:space:]]%',
  'CREATED_PROCESSOR_BLANK_SUBSCRIPTION_ID_GUARD_MISSING');

set local role authenticated;
select set_config('request.jwt.claim.sub','a9100000-0000-4000-8000-000000000003',true);
update public.subscriptions
set provider_subscription_id='browser-forged-subscription',
    current_period_ends_at='2030-01-01T00:00:00Z'
where salon_id='a9200000-0000-4000-8000-000000000003';
reset role;
select pg_temp.assert_true((select provider_subscription_id='subscription-test'
  and current_period_ends_at='2026-08-01T00:00:00Z'
  from public.subscriptions where salon_id='a9200000-0000-4000-8000-000000000003'),
  'AUTHENTICATED_BROWSER_CHANGED_PROVIDER_OR_PERIOD_DATA');

rollback;

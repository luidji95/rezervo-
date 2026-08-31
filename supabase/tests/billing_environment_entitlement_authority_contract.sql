-- Execute only against a disposable database after migration 202608240038.
begin;

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_value, false) then raise exception '%', p_message; end if;
end
$$;

do $$
declare
  v_owner uuid;
  v_salon uuid;
  v_access record;
  v_definition text;
  v_name text;
begin
  perform pg_temp.assert_true(to_regclass('private.billing_runtime_config') is not null,
    'BILLING_RUNTIME_CONFIG_TABLE_MISSING');
  perform pg_temp.assert_true(not has_table_privilege('anon','private.billing_runtime_config','SELECT'),
    'ANON_CAN_READ_BILLING_RUNTIME_CONFIG');
  perform pg_temp.assert_true(not has_table_privilege('authenticated','private.billing_runtime_config','SELECT'),
    'AUTHENTICATED_CAN_READ_BILLING_RUNTIME_CONFIG');
  perform pg_temp.assert_true(not has_table_privilege('service_role','private.billing_runtime_config','SELECT'),
    'SERVICE_ROLE_CAN_READ_BILLING_RUNTIME_CONFIG');
  perform pg_temp.assert_true(not has_table_privilege('anon','private.billing_runtime_config','INSERT,UPDATE,DELETE'),
    'ANON_CAN_WRITE_BILLING_RUNTIME_CONFIG');
  perform pg_temp.assert_true(not has_table_privilege('authenticated','private.billing_runtime_config','INSERT,UPDATE,DELETE'),
    'AUTHENTICATED_CAN_WRITE_BILLING_RUNTIME_CONFIG');
  perform pg_temp.assert_true(not has_table_privilege('service_role','private.billing_runtime_config','INSERT,UPDATE,DELETE'),
    'SERVICE_ROLE_CAN_WRITE_BILLING_RUNTIME_CONFIG');
  perform pg_temp.assert_true(not has_schema_privilege('anon','private','USAGE')
    and not has_schema_privilege('authenticated','private','USAGE')
    and not has_schema_privilege('service_role','private','USAGE'),
    'APPLICATION_ROLE_CAN_USE_PRIVATE_SCHEMA');

  foreach v_name in array array[
    'resolve_salon_access_v1','resolve_employee_capacity_v1'
  ] loop
    perform pg_temp.assert_true(not has_function_privilege('anon',
      case when v_name='resolve_salon_access_v1'
        then 'public.resolve_salon_access_v1(uuid,timestamptz)'
        else 'public.resolve_employee_capacity_v1(uuid,timestamptz)' end,
      'EXECUTE'), 'ANON_CAN_CALL_CANONICAL_RESOLVER');
    perform pg_temp.assert_true(not has_function_privilege('authenticated',
      case when v_name='resolve_salon_access_v1'
        then 'public.resolve_salon_access_v1(uuid,timestamptz)'
        else 'public.resolve_employee_capacity_v1(uuid,timestamptz)' end,
      'EXECUTE'), 'AUTHENTICATED_CAN_CALL_CANONICAL_RESOLVER');
  end loop;

  select pg_get_functiondef('public.resolve_salon_access_v1(uuid,timestamptz)'::regprocedure)
    into v_definition;
  perform pg_temp.assert_true(v_definition ilike '%private.billing_runtime_config%',
    'SALON_RESOLVER_DOES_NOT_OWN_ENVIRONMENT_LOOKUP');
  perform pg_temp.assert_true(v_definition not ilike '%p_environment%',
    'SALON_RESOLVER_EXPOSES_ENVIRONMENT_ARGUMENT');
  perform pg_temp.assert_true(v_definition ilike '%billing_provider is null%'
    and v_definition ilike '%provider_subscription_id is null%',
    'LOCAL_TRIAL_AUTHORITY_NOT_EXPLICIT');

  foreach v_name in array array[
    'assert_salon_admin_write_access_v1','create_public_booking_atomic',
    'create_owner_appointment_atomic_v1',
    'get_salon_reminder_usage'
  ] loop
    select pg_get_functiondef(p.oid) into v_definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name
    order by p.oid desc limit 1;
    perform pg_temp.assert_true(v_definition ilike '%resolve_salon_access_v1%'
      or v_definition ilike '%resolve_employee_capacity_v1%'
      or v_definition ilike '%assert_salon_admin_write_access_v1%'
      or v_definition ilike '%assert_owner_manager_appointment_access_v1%'
      or v_definition ilike '%enforce_employee_capacity_v1%',
      'GATEWAY_NOT_CANONICAL: '||v_name);
    perform pg_temp.assert_true(v_definition not ilike '%p_environment%',
      'GATEWAY_EXPOSES_ENVIRONMENT_ARGUMENT: '||v_name);
  end loop;

  select pg_get_functiondef('public.enforce_employee_capacity_v1()'::regprocedure)
    into v_definition;
  perform pg_temp.assert_true(v_definition ilike '%resolve_employee_capacity_v1%',
    'EMPLOYEE_CAPACITY_TRIGGER_NOT_CANONICAL');

  v_owner := 'b9a00000-0000-4000-8000-000000000001';
  v_salon := 'b9a00000-0000-4000-8000-000000000002';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner,'b9a-authority@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'B9a Authority','b9a-authority');

  -- Provider-free local trial remains project-local even before bootstrap.
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(v_access.has_full_access and v_access.access_reason='active_trial',
    'PROVIDER_FREE_LOCAL_TRIAL_DENIED');

  update public.subscriptions set
    status='active', billing_provider='lemonsqueezy', billing_environment='test',
    provider_customer_id='b9a-customer', provider_subscription_id='b9a-subscription',
    trial_starts_at=null, trial_ends_at=null,
    current_period_starts_at='2026-08-01T00:00:00Z',
    current_period_ends_at='2026-09-01T00:00:00Z',
    provider_state_updated_at='2026-08-01T00:00:00Z'
  where salon_id=v_salon;

  -- Missing config fails closed.
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(not v_access.has_full_access
    and v_access.access_reason='billing_environment_mismatch',
    'MISSING_CONFIG_GRANTED_PROVIDER_ACCESS');

  insert into private.billing_runtime_config(singleton,environment) values(true,'test');
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(v_access.has_full_access and v_access.access_reason='active_period',
    'TEST_CONFIG_DENIED_TEST_SUBSCRIPTION');

  update private.billing_runtime_config set environment='live',updated_at=pg_catalog.now() where singleton;
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(not v_access.has_full_access,
    'LIVE_CONFIG_GRANTED_TEST_SUBSCRIPTION');

  update public.subscriptions set billing_environment='live' where salon_id=v_salon;
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(v_access.has_full_access,
    'LIVE_CONFIG_DENIED_LIVE_SUBSCRIPTION');

  update private.billing_runtime_config set environment='test',updated_at=pg_catalog.now() where singleton;
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(not v_access.has_full_access,
    'TEST_CONFIG_GRANTED_LIVE_SUBSCRIPTION');

  -- Transaction-local structural corruption proves the resolver itself fails closed;
  -- the production constraint normally prevents this row from being stored.
  alter table public.subscriptions drop constraint subscriptions_provider_metadata_consistent;
  update public.subscriptions set billing_environment=null where salon_id=v_salon;
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(not v_access.has_full_access,
    'PROVIDER_BACKED_NULL_ENVIRONMENT_GRANTED_ACCESS');

  update public.subscriptions set status='trialing',billing_environment=null,
    trial_starts_at='2026-08-20T00:00:00Z',trial_ends_at='2026-09-03T00:00:00Z',
    current_period_starts_at=null,current_period_ends_at=null
  where salon_id=v_salon;
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(not v_access.has_full_access,
    'PROVIDER_BACKED_TRIAL_MISCLASSIFIED_AS_LOCAL');

  update public.subscriptions set status='expired' where salon_id=v_salon;
  insert into public.billing_access_overrides(
    salon_id,plan_id,override_type,reason,starts_at
  ) select v_salon,id,'support','B9a explicit admin authority','2026-08-01T00:00:00Z'
    from public.plans where slug='pro';
  delete from private.billing_runtime_config;
  select * into v_access from public.resolve_salon_access_v1(v_salon,'2026-08-24T12:00:00Z');
  perform pg_temp.assert_true(v_access.has_full_access
    and v_access.access_source='billing_override',
    'ADMIN_OVERRIDE_LOST_ENVIRONMENT_INDEPENDENT_AUTHORITY');

  begin
    insert into private.billing_runtime_config(singleton,environment) values(false,'test');
    raise exception 'INVALID_SINGLETON_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    insert into private.billing_runtime_config(singleton,environment) values(true,'invalid');
    raise exception 'INVALID_ENVIRONMENT_ACCEPTED';
  exception when check_violation then null;
  end;
end
$$;

rollback;

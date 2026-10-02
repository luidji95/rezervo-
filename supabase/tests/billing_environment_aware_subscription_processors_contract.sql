\set ON_ERROR_STOP on
begin;

create function pg_temp.make_billing_salon(p_label text)
returns table(owner_id uuid, salon_id uuid, subscription_id uuid)
language plpgsql
as $$
begin
  owner_id := gen_random_uuid();
  salon_id := gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(owner_id,owner_id||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(salon_id,owner_id,p_label,p_label||'-'||substr(salon_id::text,1,8));
  select s.id into subscription_id
  from public.subscriptions s
  where s.salon_id=make_billing_salon.salon_id;
  return next;
end;
$$;

create function pg_temp.make_checkout(
  p_owner uuid, p_salon uuid, p_plan uuid, p_environment text
) returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  insert into public.billing_checkout_sessions(
    salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status
  ) values(p_salon,p_owner,p_plan,'lemonsqueezy',p_environment,gen_random_uuid(),'open')
  returning id into v_id;
  return v_id;
end;
$$;

create function pg_temp.ingest_created(
  p_environment text, p_checkout uuid, p_salon uuid, p_suffix text,
  p_store text, p_product text, p_variant text
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_idempotency uuid;
begin
  select idempotency_key into v_idempotency
  from public.billing_checkout_sessions where id=p_checkout;
  select event_id into v_id
  from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy',p_environment,'subscription_created','subscriptions','sub-'||p_suffix,
    encode(digest('event-'||p_suffix,'sha256'),'hex'),
    encode(digest('semantic-'||p_suffix,'sha256'),'hex'),
    'received',null,true,p_checkout,p_salon,'starter',v_idempotency,
    'sub-'||p_suffix,'order-'||p_suffix,'customer-'||p_suffix,
    p_product,p_variant,'active',
    '2026-07-01T00:00:00Z','2026-07-01T00:01:00Z',
    (p_environment='test'),'ready',null,p_store,'2026-09-01T00:00:00Z',
    null,false,null,null,null
  );
  return v_id;
end;
$$;

create function pg_temp.ingest_updated(
  p_environment text, p_subscription text, p_suffix text, p_status text,
  p_updated_at timestamptz, p_renews_at timestamptz, p_ends_at timestamptz,
  p_cancelled boolean,
  p_store_id text default null,
  p_product_id text default null,
  p_variant_id text default null
) returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  select event_id into v_id
  from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy',p_environment,'subscription_updated','subscriptions',p_subscription,
    encode(digest('event-'||p_suffix,'sha256'),'hex'),
    encode(digest('semantic-'||p_suffix,'sha256'),'hex'),
    'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    p_subscription,'order-'||p_suffix,
    case when p_environment='test' then 'customer-test-valid' else 'customer-live-valid' end,
    coalesce(p_product_id,case when p_environment='test' then 'product-test-v2' else 'product-live-v2' end),
    coalesce(p_variant_id,case when p_environment='test' then 'variant-test-v2' else 'variant-live-v2' end),
    p_status,'2026-07-01T00:00:00Z',p_updated_at,
    (p_environment='test'),'ready',null,
    coalesce(p_store_id,case when p_environment='test' then 'store-test-v2' else 'store-live-v2' end),
    p_renews_at,p_ends_at,p_cancelled,null,null,null
  );
  return v_id;
end;
$$;

do $$
declare
  v_def_created text;
  v_def_updated text;
begin
  if to_regprocedure('public.process_billing_subscription_created_v2(uuid,timestamptz)') is null
     or to_regprocedure('public.process_billing_subscription_updated_v2(uuid,timestamptz)') is null then
    raise exception 'PROCESSOR_V2_FUNCTIONS_MISSING';
  end if;
  if exists (
    select 1
    from (values
      ('public.process_billing_subscription_created_v1(uuid,timestamptz)'::regprocedure,
       'public.process_billing_subscription_created_v2(uuid,timestamptz)'::regprocedure),
      ('public.process_billing_subscription_updated_v1(uuid,timestamptz)'::regprocedure,
       'public.process_billing_subscription_updated_v2(uuid,timestamptz)'::regprocedure)
    ) expected(v1_oid,v2_oid)
    join pg_proc v1 on v1.oid=expected.v1_oid
    join pg_proc v2 on v2.oid=expected.v2_oid
    where v2.proargtypes is distinct from v1.proargtypes
       or v2.proallargtypes is distinct from v1.proallargtypes
       or v2.proargmodes is distinct from v1.proargmodes
       or v2.proargnames is distinct from v1.proargnames
       or v2.prorettype is distinct from v1.prorettype
       or v2.proretset is distinct from v1.proretset
       or v2.pronargdefaults is distinct from v1.pronargdefaults
  ) then raise exception 'PROCESSOR_V2_SIGNATURE_OR_RETURN_CONTRACT_CHANGED'; end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.process_billing_subscription_created_v2(uuid,timestamptz)'::regprocedure,
      'public.process_billing_subscription_updated_v2(uuid,timestamptz)'::regprocedure
    )
      and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])
  ) then raise exception 'PROCESSOR_V2_SECURITY_METADATA_INVALID'; end if;
  if exists(
       select 1 from pg_proc p
       cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
       where p.oid in (
         'public.process_billing_subscription_created_v2(uuid,timestamptz)'::regprocedure,
         'public.process_billing_subscription_updated_v2(uuid,timestamptz)'::regprocedure
       ) and acl.grantee=0 and acl.privilege_type='EXECUTE'
     )
     or has_function_privilege('anon','public.process_billing_subscription_created_v2(uuid,timestamptz)','execute')
     or has_function_privilege('authenticated','public.process_billing_subscription_created_v2(uuid,timestamptz)','execute')
     or not has_function_privilege('service_role','public.process_billing_subscription_created_v2(uuid,timestamptz)','execute')
     or has_function_privilege('anon','public.process_billing_subscription_updated_v2(uuid,timestamptz)','execute')
     or has_function_privilege('authenticated','public.process_billing_subscription_updated_v2(uuid,timestamptz)','execute')
     or not has_function_privilege('service_role','public.process_billing_subscription_updated_v2(uuid,timestamptz)','execute') then
    raise exception 'PROCESSOR_V2_GRANTS_INVALID';
  end if;
  select pg_get_functiondef('public.process_billing_subscription_created_v2(uuid,timestamptz)'::regprocedure)
    into v_def_created;
  select pg_get_functiondef('public.process_billing_subscription_updated_v2(uuid,timestamptz)'::regprocedure)
    into v_def_updated;
  if v_def_created !~ 'v_event\.environment'
     or v_def_updated !~ 'v_event\.environment'
     or v_def_created ~ 'p_environment'
     or v_def_updated ~ 'p_environment'
     or v_def_created ~* 'execute[[:space:]]'
     or v_def_updated ~* 'execute[[:space:]]' then
    raise exception 'PROCESSOR_V2_ENVIRONMENT_AUTHORITY_INVALID';
  end if;
end;
$$;

do $$
declare
  v_plan uuid;
  v_pro uuid;
  v_test record;
  v_live record;
  v_cross record;
  v_cross_reverse record;
  v_mode record;
  v_owner_cross record;
  v_owner_cross_reverse record;
  v_other_provider record;
  v_invalid_active record;
  v_identity record;
  v_inactive_plan record;
  v_inactive_mapping record;
  v_created_identity record;
  v_created_identity_case record;
  v_checkout uuid;
  v_event uuid;
  v_outcome text;
  v_error text;
  v_before text;
  v_checkout_before text;
  v_other_before text;
begin
  select id into v_plan from public.plans where slug='starter' and is_active=true;
  select id into v_pro from public.plans where slug='pro';

  insert into public.billing_provider_prices(
    plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active
  )
  select v_plan,'lemonsqueezy',e.environment,'monthly',p.currency,p.monthly_price,
    'product-'||e.environment||'-v2','variant-'||e.environment||'-v2',
    'store-'||e.environment||'-v2',true
  from public.plans p
  cross join (values('test'::text),('live'::text)) e(environment)
  where p.id=v_plan
  on conflict(provider,environment,plan_id,billing_interval,currency)
  do update set provider_product_id=excluded.provider_product_id,
    provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=true;

  insert into public.billing_provider_prices(
    plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active
  ) select v_pro,'lemonsqueezy','test','monthly',currency,monthly_price,
    'product-pro-v2','variant-pro-v2','store-test-v2',false
  from public.plans where id=v_pro
  on conflict(provider,environment,plan_id,billing_interval,currency)
  do update set provider_product_id=excluded.provider_product_id,
    provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=false;

  select * into v_test from pg_temp.make_billing_salon('processor-v2-test');
  v_checkout := pg_temp.make_checkout(v_test.owner_id,v_test.salon_id,v_plan,'test');
  v_event := pg_temp.ingest_created(
    'test',v_checkout,v_test.salon_id,'test-valid',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'processed' or v_error is not null then
    raise exception 'CREATED_V2_TEST_FAILED';
  end if;
  if not exists(
    select 1 from public.subscriptions
    where id=v_test.subscription_id and billing_environment='test'
      and provider_subscription_id='sub-test-valid'
      and provider_customer_id='customer-test-valid'
      and current_period_starts_at is not null
      and current_period_ends_at>current_period_starts_at
      and provider_state_updated_at is not null
  ) then raise exception 'CREATED_V2_TEST_STATE_INVALID'; end if;
  select outcome into v_outcome
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:01Z');
  if v_outcome<>'already_processed' then raise exception 'CREATED_V2_NOT_IDEMPOTENT'; end if;

  select * into v_live from pg_temp.make_billing_salon('processor-v2-live');
  v_checkout := pg_temp.make_checkout(v_live.owner_id,v_live.salon_id,v_plan,'live');
  v_event := pg_temp.ingest_created(
    'live',v_checkout,v_live.salon_id,'live-valid',
    'store-live-v2','product-live-v2','variant-live-v2'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'processed' or v_error is not null
     or not exists(
       select 1 from public.subscriptions
       where id=v_live.subscription_id and billing_environment='live'
         and provider_subscription_id='sub-live-valid'
         and current_period_ends_at>current_period_starts_at
         and provider_state_updated_at is not null
     ) then raise exception 'CREATED_V2_LIVE_FAILED'; end if;

  select * into v_inactive_plan from pg_temp.make_billing_salon('processor-v2-inactive-plan');
  v_checkout := pg_temp.make_checkout(v_inactive_plan.owner_id,v_inactive_plan.salon_id,v_plan,'test');
  v_event := pg_temp.ingest_created(
    'test',v_checkout,v_inactive_plan.salon_id,'inactive-plan',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  update public.plans set is_active=false where id=v_plan;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'processed' or v_error is not null
     or not exists(
       select 1 from public.subscriptions
       where id=v_inactive_plan.subscription_id and status='active'
         and billing_environment='test' and provider_subscription_id='sub-inactive-plan'
     )
     or not exists(
       select 1 from public.billing_checkout_sessions
       where id=v_checkout and status='completed'
         and resulting_subscription_id=v_inactive_plan.subscription_id
     )
  then raise exception 'CREATED_V2_INACTIVE_PLAN_PAYMENT_RACE_FAILED'; end if;
  update public.plans set is_active=true where id=v_plan;

  select * into v_inactive_mapping from pg_temp.make_billing_salon('processor-v2-inactive-mapping');
  v_checkout := pg_temp.make_checkout(v_inactive_mapping.owner_id,v_inactive_mapping.salon_id,v_plan,'test');
  v_event := pg_temp.ingest_created(
    'test',v_checkout,v_inactive_mapping.salon_id,'inactive-mapping',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  update public.billing_provider_prices set is_active=false
  where provider='lemonsqueezy' and environment='test' and plan_id=v_plan
    and billing_interval='monthly';
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'processed' or v_error is not null
     or not exists(
       select 1 from public.subscriptions
       where id=v_inactive_mapping.subscription_id and status='active'
         and billing_environment='test' and provider_subscription_id='sub-inactive-mapping'
     )
     or not exists(
       select 1 from public.billing_checkout_sessions
       where id=v_checkout and status='completed'
         and resulting_subscription_id=v_inactive_mapping.subscription_id
     )
  then raise exception 'CREATED_V2_INACTIVE_MAPPING_PAYMENT_RACE_FAILED'; end if;

  for v_created_identity in
    select * from (values
      ('wrong-store'::text,'wrong-store','product-test-v2','variant-test-v2'),
      ('wrong-product','store-test-v2','wrong-product','variant-test-v2'),
      ('wrong-variant','store-test-v2','product-test-v2','wrong-variant'),
      ('other-environment-identity','store-live-v2','product-live-v2','variant-live-v2')
    ) identity_cases(suffix,store_id,product_id,variant_id)
  loop
    update public.billing_provider_prices set is_active=true
    where provider='lemonsqueezy' and environment='test' and plan_id=v_plan
      and billing_interval='monthly';
    select * into v_created_identity_case
    from pg_temp.make_billing_salon('created-'||v_created_identity.suffix);
    v_checkout := pg_temp.make_checkout(
      v_created_identity_case.owner_id,v_created_identity_case.salon_id,v_plan,'test'
    );
    v_event := pg_temp.ingest_created(
      'test',v_checkout,v_created_identity_case.salon_id,
      'created-'||v_created_identity.suffix,
      v_created_identity.store_id,v_created_identity.product_id,v_created_identity.variant_id
    );
    update public.billing_provider_prices set is_active=false
    where provider='lemonsqueezy' and environment='test' and plan_id=v_plan
      and billing_interval='monthly';
    select md5(row_to_json(s)::text) into v_before
    from public.subscriptions s where id=v_created_identity_case.subscription_id;
    select md5(row_to_json(c)::text) into v_checkout_before
    from public.billing_checkout_sessions c where id=v_checkout;
    select outcome,error_code into v_outcome,v_error
    from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
    if v_outcome<>'manual_review' or v_error<>'processor_provider_mapping_invalid'
       or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_created_identity_case.subscription_id)
       or v_checkout_before<>(select md5(row_to_json(c)::text) from public.billing_checkout_sessions c where id=v_checkout)
    then raise exception 'CREATED_V2_INACTIVE_MAPPING_IDENTITY_FAILED_%',v_created_identity.suffix; end if;
  end loop;
  update public.billing_provider_prices set is_active=true
  where provider='lemonsqueezy' and environment='test' and plan_id=v_plan
    and billing_interval='monthly';

  select * into v_cross from pg_temp.make_billing_salon('processor-v2-cross-checkout');
  v_checkout := pg_temp.make_checkout(v_cross.owner_id,v_cross.salon_id,v_plan,'live');
  v_event := pg_temp.ingest_created(
    'test',v_checkout,v_cross.salon_id,'cross-checkout',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_cross.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_checkout_correlation_invalid'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_cross.subscription_id)
  then raise exception 'CREATED_V2_CROSS_CHECKOUT_NOT_REJECTED'; end if;

  select * into v_cross_reverse from pg_temp.make_billing_salon('processor-v2-cross-checkout-reverse');
  v_checkout := pg_temp.make_checkout(v_cross_reverse.owner_id,v_cross_reverse.salon_id,v_plan,'test');
  v_event := pg_temp.ingest_created(
    'live',v_checkout,v_cross_reverse.salon_id,'cross-checkout-reverse',
    'store-live-v2','product-live-v2','variant-live-v2'
  );
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_cross_reverse.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_checkout_correlation_invalid'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_cross_reverse.subscription_id)
  then raise exception 'CREATED_V2_REVERSE_CROSS_CHECKOUT_NOT_REJECTED'; end if;

  select * into v_mode from pg_temp.make_billing_salon('processor-v2-mode');
  v_checkout := pg_temp.make_checkout(v_mode.owner_id,v_mode.salon_id,v_plan,'test');
  v_event := pg_temp.ingest_created(
    'test',v_checkout,v_mode.salon_id,'mode-mismatch',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  update public.billing_webhook_subscription_facts set test_mode=false where webhook_event_id=v_event;
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_mode.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_facts_contract_invalid'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_mode.subscription_id)
  then raise exception 'CREATED_V2_MODE_MISMATCH_NOT_REJECTED'; end if;

  select * into v_owner_cross from pg_temp.make_billing_salon('processor-v2-owner-cross');
  update public.subscriptions set
    status='active',plan_id=v_plan,billing_provider='lemonsqueezy',billing_environment='live',
    provider_customer_id='customer-existing-live',provider_subscription_id='sub-existing-live',
    current_period_starts_at='2026-07-01T00:00:00Z',
    current_period_ends_at='2026-09-01T00:00:00Z',
    provider_state_updated_at='2026-07-01T00:01:00Z'
  where id=v_owner_cross.subscription_id;
  v_checkout := pg_temp.make_checkout(v_owner_cross.owner_id,v_owner_cross.salon_id,v_plan,'test');
  v_event := pg_temp.ingest_created(
    'test',v_checkout,v_owner_cross.salon_id,'owner-cross',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_owner_cross.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_provider_ownership_conflict'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_owner_cross.subscription_id)
  then raise exception 'CREATED_V2_CROSS_OWNERSHIP_NOT_REJECTED'; end if;

  select * into v_owner_cross_reverse from pg_temp.make_billing_salon('processor-v2-owner-cross-reverse');
  update public.subscriptions set
    status='active',plan_id=v_plan,billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id='customer-existing-test',provider_subscription_id='sub-existing-test',
    current_period_starts_at='2026-07-01T00:00:00Z',
    current_period_ends_at='2026-09-01T00:00:00Z',
    provider_state_updated_at='2026-07-01T00:01:00Z'
  where id=v_owner_cross_reverse.subscription_id;
  v_checkout := pg_temp.make_checkout(v_owner_cross_reverse.owner_id,v_owner_cross_reverse.salon_id,v_plan,'live');
  v_event := pg_temp.ingest_created(
    'live',v_checkout,v_owner_cross_reverse.salon_id,'owner-cross-reverse',
    'store-live-v2','product-live-v2','variant-live-v2'
  );
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_owner_cross_reverse.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_provider_ownership_conflict'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_owner_cross_reverse.subscription_id)
  then raise exception 'CREATED_V2_REVERSE_CROSS_OWNERSHIP_NOT_REJECTED'; end if;

  select * into v_other_provider from pg_temp.make_billing_salon('processor-v2-other-provider');
  update public.subscriptions set status='past_due',plan_id=v_plan,
    billing_provider='stripe',billing_environment='live'
  where id=v_other_provider.subscription_id;
  v_checkout := pg_temp.make_checkout(v_other_provider.owner_id,v_other_provider.salon_id,v_plan,'test');
  v_event := pg_temp.ingest_created(
    'test',v_checkout,v_other_provider.salon_id,'other-provider',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_other_provider.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_provider_ownership_conflict'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_other_provider.subscription_id)
  then raise exception 'CREATED_V2_OTHER_PROVIDER_MUTATED'; end if;

  select md5(row_to_json(s)::text) into v_other_before from public.subscriptions s where id=v_live.subscription_id;
  v_event := pg_temp.ingest_updated(
    'test','sub-test-valid','updated-test-active','active',
    '2026-07-02T00:00:00Z','2026-09-02T00:00:00Z',null,false
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'processed' or v_error is not null
     or v_other_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_live.subscription_id)
  then raise exception 'UPDATED_V2_TEST_ISOLATION_FAILED'; end if;

  select md5(row_to_json(s)::text) into v_other_before from public.subscriptions s where id=v_test.subscription_id;
  v_event := pg_temp.ingest_updated(
    'live','sub-live-valid','updated-live-active','active',
    '2026-07-02T00:00:00Z','2026-09-02T00:00:00Z',null,false
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'processed' or v_error is not null
     or v_other_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_test.subscription_id)
  then raise exception 'UPDATED_V2_LIVE_ISOLATION_FAILED'; end if;

  v_event := pg_temp.ingest_updated(
    'test','sub-live-valid','updated-cross','active',
    '2026-07-03T00:00:00Z','2026-09-03T00:00:00Z',null,false
  );
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_live.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_updated_subscription_unknown'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_live.subscription_id)
  then raise exception 'UPDATED_V2_CROSS_ENVIRONMENT_NOT_REJECTED'; end if;

  v_event := pg_temp.ingest_updated(
    'live','sub-test-valid','updated-cross-reverse','active',
    '2026-07-03T00:00:00Z','2026-09-03T00:00:00Z',null,false
  );
  select md5(row_to_json(s)::text) into v_before from public.subscriptions s where id=v_test.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_updated_subscription_unknown'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_test.subscription_id)
  then raise exception 'UPDATED_V2_REVERSE_CROSS_ENVIRONMENT_NOT_REJECTED'; end if;

  for v_identity in
    select * from (values
      ('wrong-store'::text,'wrong-store','product-test-v2','variant-test-v2'),
      ('wrong-product','store-test-v2','wrong-product','variant-test-v2'),
      ('wrong-variant','store-test-v2','product-test-v2','wrong-variant'),
      ('other-environment-mapping','store-live-v2','product-live-v2','variant-live-v2')
    ) identity_cases(suffix,store_id,product_id,variant_id)
  loop
    v_event := pg_temp.ingest_updated(
      'test','sub-test-valid','updated-'||v_identity.suffix,'active',
      '2026-07-03T00:00:00Z','2026-09-03T00:00:00Z',null,false,
      v_identity.store_id,v_identity.product_id,v_identity.variant_id
    );
    select md5(row_to_json(s)::text) into v_before
    from public.subscriptions s where id=v_test.subscription_id;
    select outcome,error_code into v_outcome,v_error
    from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
    if v_outcome<>'manual_review'
       or v_error<>'processor_updated_provider_mapping_invalid'
       or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_test.subscription_id)
    then raise exception 'UPDATED_V2_IDENTITY_MISMATCH_FAILED_%',v_identity.suffix; end if;
  end loop;

  v_event := pg_temp.ingest_updated(
    'test','sub-test-valid','updated-mode-mismatch','active',
    '2026-07-03T00:00:00Z','2026-09-03T00:00:00Z',null,false
  );
  update public.billing_webhook_subscription_facts
  set test_mode=false where webhook_event_id=v_event;
  select md5(row_to_json(s)::text) into v_before
  from public.subscriptions s where id=v_test.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review'
     or v_error<>'processor_updated_facts_contract_invalid'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_test.subscription_id)
  then raise exception 'UPDATED_V2_MODE_MISMATCH_NOT_REJECTED'; end if;

  update public.plans set is_active=false where id=v_pro;
  v_event := pg_temp.ingest_updated(
    'test','sub-test-valid','updated-plan-change','active',
    '2026-07-03T00:00:00Z','2026-09-03T00:00:00Z',null,false,
    'store-test-v2','product-pro-v2','variant-pro-v2'
  );
  select md5(row_to_json(s)::text) into v_before
  from public.subscriptions s where id=v_test.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review'
     or v_error<>'processor_updated_plan_change_unsupported'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_test.subscription_id)
  then raise exception 'UPDATED_V2_INACTIVE_PLAN_CHANGE_NOT_DETECTED'; end if;
  update public.plans set is_active=true where id=v_pro;

  v_event := pg_temp.ingest_updated(
    'test','sub-test-valid','updated-stale','active',
    '2026-07-01T12:00:00Z','2026-09-01T12:00:00Z',null,false
  );
  select outcome into v_outcome
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'stale_ignored' then raise exception 'UPDATED_V2_STALE_FAILED'; end if;

  v_event := pg_temp.ingest_updated(
    'test','sub-test-valid','updated-equal','active',
    '2026-07-02T00:00:00Z','2026-09-02T00:00:00Z',null,false
  );
  select outcome into v_outcome
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'already_applied' then raise exception 'UPDATED_V2_ALREADY_APPLIED_FAILED'; end if;
  select outcome into v_outcome
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:01Z');
  if v_outcome<>'already_processed' then raise exception 'UPDATED_V2_REPLAY_FAILED'; end if;

  select * into v_invalid_active from pg_temp.make_billing_salon('processor-v2-invalid-active');
  update public.subscriptions set
    status='past_due',plan_id=v_plan,billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id='customer-test-valid',provider_subscription_id='sub-invalid-active',
    current_period_starts_at=null,current_period_ends_at=null,
    provider_state_updated_at='2026-07-01T00:01:00Z'
  where id=v_invalid_active.subscription_id;
  v_event := pg_temp.ingest_updated(
    'test','sub-invalid-active','updated-invalid-active','active',
    '2026-07-02T00:00:00Z','2026-09-02T00:00:00Z',null,false
  );
  select md5(row_to_json(s)::text) into v_before
  from public.subscriptions s where id=v_invalid_active.subscription_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_event,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review'
     or v_error<>'processor_updated_provider_state_unsupported'
     or v_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_invalid_active.subscription_id)
  then raise exception 'UPDATED_V2_CONSTRAINT_029_PREFLIGHT_FAILED'; end if;
end;
$$;

do $$
declare
  v_plan uuid;
  v_case record;
  v_checkout uuid;
  v_created uuid;
  v_updated uuid;
  v_outcome text;
  v_error text;
  v_status text;
begin
  select id into v_plan from public.plans where slug='starter';
  select * into v_case from pg_temp.make_billing_salon('processor-v2-dependency');
  v_checkout := pg_temp.make_checkout(v_case.owner_id,v_case.salon_id,v_plan,'test');
  v_created := pg_temp.ingest_created(
    'test',v_checkout,v_case.salon_id,'dependency-test',
    'store-test-v2','product-test-v2','variant-test-v2'
  );
  v_updated := pg_temp.ingest_updated(
    'test','sub-dependency-test','dependency-updated','active',
    '2026-07-02T00:00:00Z','2026-09-02T00:00:00Z',null,false
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_updated,'2026-08-01T00:00:00Z');
  if v_outcome<>'dependency_pending'
     or v_error<>'processor_updated_created_dependency_pending' then
    raise exception 'UPDATED_V2_SAME_ENV_DEPENDENCY_FAILED';
  end if;

  select * into v_case from pg_temp.make_billing_salon('processor-v2-other-dependency');
  v_checkout := pg_temp.make_checkout(v_case.owner_id,v_case.salon_id,v_plan,'live');
  v_created := pg_temp.ingest_created(
    'live',v_checkout,v_case.salon_id,'dependency-other',
    'store-live-v2','product-live-v2','variant-live-v2'
  );
  v_updated := pg_temp.ingest_updated(
    'test','sub-dependency-other','dependency-other-updated','active',
    '2026-07-02T00:00:00Z','2026-09-02T00:00:00Z',null,false
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v2(v_updated,'2026-08-01T00:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_updated_subscription_unknown' then
    raise exception 'UPDATED_V2_CROSS_ENV_DEPENDENCY_ACCEPTED';
  end if;

  select * into v_case from pg_temp.make_billing_salon('processor-v2-lifecycle');
  update public.subscriptions set
    status='active',plan_id=v_plan,billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id='customer-test-valid',provider_subscription_id='sub-lifecycle',
    current_period_starts_at='2026-07-01T00:00:00Z',
    current_period_ends_at='2026-09-01T00:00:00Z',
    provider_state_updated_at='2026-07-01T00:01:00Z'
  where id=v_case.subscription_id;
  update public.billing_provider_prices set is_active=false
  where provider='lemonsqueezy' and environment='test' and plan_id=v_plan
    and billing_interval='monthly';
  update public.plans set is_active=false where id=v_plan;
  for v_status in select unnest(array['cancelled','active','past_due','unpaid','active','expired'])
  loop
    v_updated := pg_temp.ingest_updated(
      'test','sub-lifecycle','lifecycle-'||v_status||'-'||clock_timestamp()::text,v_status,
      case v_status
        when 'cancelled' then '2026-07-02T00:00:00Z'::timestamptz
        when 'past_due' then '2026-07-04T00:00:00Z'::timestamptz
        when 'unpaid' then '2026-07-05T00:00:00Z'::timestamptz
        when 'expired' then '2026-08-01T00:00:00Z'::timestamptz
        else case when (select provider_state_updated_at<'2026-07-03' from public.subscriptions where id=v_case.subscription_id)
          then '2026-07-03T00:00:00Z'::timestamptz else '2026-07-06T00:00:00Z'::timestamptz end
      end,
      case when v_status='active' then '2026-09-10T00:00:00Z'::timestamptz else null end,
      case when v_status='cancelled' then '2026-09-05T00:00:00Z'::timestamptz
           when v_status='expired' then '2026-07-31T00:00:00Z'::timestamptz else null end,
      v_status='cancelled'
    );
    select outcome,error_code into v_outcome,v_error
    from public.process_billing_subscription_updated_v2(v_updated,'2026-08-01T00:00:00Z');
    if v_outcome<>'processed' or v_error is not null then
      raise exception 'UPDATED_V2_LIFECYCLE_FAILED_%_%',v_status,v_error;
    end if;
  end loop;
  if not exists(
    select 1 from public.subscriptions where id=v_case.subscription_id and status='expired'
  ) then raise exception 'UPDATED_V2_EXPIRED_STATE_INVALID'; end if;
  update public.plans set is_active=true where id=v_plan;
  update public.billing_provider_prices set is_active=true
  where provider='lemonsqueezy' and environment='test' and plan_id=v_plan
    and billing_interval='monthly';
end;
$$;

rollback;

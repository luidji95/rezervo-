\set ON_ERROR_STOP on
begin;

create function pg_temp.make_processor_case(
  p_owner uuid,
  p_salon uuid,
  p_plan uuid,
  p_provider_object_id text,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_hash_character text
)
returns table(event_id uuid, checkout_id uuid)
language plpgsql
as $$
declare
  v_idempotency uuid := gen_random_uuid();
begin
  insert into public.billing_checkout_sessions(
    salon_id,actor_profile_id,requested_plan_id,provider,environment,
    idempotency_key,status
  ) values(p_salon,p_owner,p_plan,'lemonsqueezy','test',v_idempotency,'open')
  returning id into checkout_id;

  select i.event_id into event_id
  from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions',p_provider_object_id,
    repeat(p_hash_character,64),repeat(p_hash_character,64),
    'received',null,true,checkout_id,p_salon,'starter',v_idempotency,
    p_provider_subscription_id,'order-'||p_hash_character,p_provider_customer_id,
    'product-contract','variant-contract','active',
    '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,'ready',null,
    '440512','2026-08-28T10:00:00Z',null,false,null,null,null
  ) i;
  return next;
end;
$$;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_salon uuid := gen_random_uuid();
  v_checkout uuid;
  v_event uuid;
  v_subscription uuid;
  v_starter uuid;
  v_pro uuid;
  v_idempotency uuid := gen_random_uuid();
  v_outcome text;
  v_error text;
  v_override_before text;
  v_checkout_before text;
  v_subscription_before text;
  v_case record;
  v_premium uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='billing_webhook_subscription_facts'
      and column_name='provider_renews_at'
  ) then raise exception 'FACTS_V2_COLUMNS_MISSING'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='subscriptions'
      and column_name='provider_state_updated_at'
  ) then raise exception 'SUBSCRIPTION_ORDERING_COLUMNS_MISSING'; end if;
  if has_function_privilege('anon', 'public.ingest_billing_webhook_event_v1(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.ingest_billing_webhook_event_v1(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.ingest_billing_webhook_event_v1(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text)', 'execute')
     or has_function_privilege('anon', 'public.ingest_billing_webhook_event_v2(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text,text,timestamptz,timestamptz,boolean,timestamptz,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.ingest_billing_webhook_event_v2(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text,text,timestamptz,timestamptz,boolean,timestamptz,text,timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.ingest_billing_webhook_event_v2(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text,text,timestamptz,timestamptz,boolean,timestamptz,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.process_billing_subscription_created_v1(uuid,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.process_billing_subscription_created_v1(uuid,timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.process_billing_subscription_created_v1(uuid,timestamptz)', 'execute') then
    raise exception 'BILLING_RPC_GRANTS_INVALID';
  end if;

  select id into v_starter from public.plans where slug='starter';
  select id into v_pro from public.plans where slug='pro';
  select id into v_premium from public.plans where slug='premium';

  update public.billing_provider_prices
  set is_active=false,provider_store_id=null
  where provider='lemonsqueezy' and environment='test' and plan_id=v_starter;
  alter table public.billing_provider_prices disable trigger billing_provider_prices_validate;
  insert into public.billing_provider_prices(
    plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active
  ) select v_premium,'lemonsqueezy','test','monthly',currency,monthly_price,
    'premium-anomaly','premium-anomaly',null,true
    from public.plans where id=v_premium;
  alter table public.billing_provider_prices enable trigger billing_provider_prices_validate;
  update public.billing_provider_prices bpp
  set provider_store_id='440512'
  from public.plans p
  where p.id=bpp.plan_id and bpp.provider='lemonsqueezy'
    and bpp.environment='test' and bpp.is_active=true and p.is_active=true
    and p.slug in ('starter','pro');
  if exists(
    select 1 from public.billing_provider_prices
    where provider='lemonsqueezy' and environment='test'
      and (plan_id=v_starter or plan_id=v_premium) and provider_store_id is not null
  ) then raise exception 'BACKFILL_TOUCHED_INACTIVE_OR_PREMIUM_MAPPING'; end if;
  delete from public.billing_provider_prices where provider_variant_id='premium-anomaly';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner, v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Processor contract','processor-'||substr(v_salon::text,1,8));
  select id into v_subscription from public.subscriptions where salon_id=v_salon;

  insert into public.billing_provider_prices(
    plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active
  ) values(v_starter,'lemonsqueezy','test','monthly','RSD',2990,
    'product-contract','variant-contract','440512',true)
  on conflict (provider,environment,plan_id,billing_interval,currency)
  do update set provider_product_id=excluded.provider_product_id,
    provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=true;

  insert into public.billing_checkout_sessions(
    salon_id,actor_profile_id,requested_plan_id,provider,environment,
    idempotency_key,status
  ) values(v_salon,v_owner,v_starter,'lemonsqueezy','test',v_idempotency,'open')
  returning id into v_checkout;

  insert into public.billing_access_overrides(
    salon_id,plan_id,override_type,reason,enabled
  ) values(v_salon,v_pro,'pilot','processor contract override',true);
  select md5(row_to_json(o)::text) into v_override_before
  from public.billing_access_overrides o where salon_id=v_salon;

  select event_id into v_event
  from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions','sub-contract',
    repeat('1',64), repeat('2',64),
    'received',null,true,v_checkout,v_salon,'starter',v_idempotency,
    'sub-contract','order-contract','customer-contract','product-contract',
    'variant-contract','active','2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',
    true,'ready',null,'440512','2026-08-28T10:00:00Z',null,false,null,null,null
  );
  if not exists (
    select 1 from public.billing_webhook_subscription_facts
    where webhook_event_id=v_event and facts_schema_version=2
      and provider_store_id='440512'
      and provider_renews_at='2026-08-28T10:00:00Z'
      and provider_cancelled=false and provider_pause_mode is null
  ) then raise exception 'FACTS_V2_NOT_STORED'; end if;

  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'processed' or v_error is not null then
    raise exception 'PROCESSOR_SUCCESS_INVALID';
  end if;
  if not exists (
    select 1 from public.subscriptions s
    where s.id=v_subscription and s.plan_id=v_starter and s.status='active'
      and s.billing_provider='lemonsqueezy' and s.billing_environment='test'
      and s.provider_customer_id='customer-contract'
      and s.provider_subscription_id='sub-contract'
      and s.current_period_starts_at='2026-07-28T10:00:00Z'
      and s.current_period_ends_at='2026-08-28T10:00:00Z'
      and s.provider_state_updated_at='2026-07-28T10:01:00Z'
      and s.provider_last_webhook_event_id=v_event
      and s.trial_starts_at is not null and s.trial_ends_at is not null
  ) then raise exception 'SUBSCRIPTION_NOT_ACTIVATED'; end if;
  if not exists (
    select 1 from public.billing_checkout_sessions
    where id=v_checkout and status='completed' and provider_order_id='order-contract'
      and resulting_subscription_id=v_subscription and completed_at is not null
  ) then raise exception 'CHECKOUT_NOT_COMPLETED'; end if;
  if not exists (
    select 1 from public.billing_webhook_events
    where id=v_event and processing_status='processed' and processed_at is not null
  ) then raise exception 'EVENT_NOT_PROCESSED'; end if;
  if v_override_before<>(select md5(row_to_json(o)::text) from public.billing_access_overrides o where salon_id=v_salon) then
    raise exception 'ACTIVE_OVERRIDE_CHANGED';
  end if;

  select outcome into v_outcome
  from public.process_billing_subscription_created_v1(v_event,'2026-07-28T12:01:00Z');
  if v_outcome<>'already_processed' then raise exception 'PROCESSOR_NOT_IDEMPOTENT'; end if;

  update public.subscriptions set billing_provider=null,billing_environment=null,
    provider_customer_id=null,provider_subscription_id=null,
    provider_state_updated_at=null,provider_last_webhook_event_id=null
  where id=v_subscription;

  select * into v_case from pg_temp.make_processor_case(
    v_owner,v_salon,v_starter,'envelope-other','facts-identity','customer-identity','3');
  select md5(row_to_json(s)::text) into v_subscription_before from public.subscriptions s where id=v_subscription;
  select md5(row_to_json(c)::text) into v_checkout_before from public.billing_checkout_sessions c where id=v_case.checkout_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v1(v_case.event_id,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_event_facts_identity_conflict'
     or v_subscription_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_subscription)
     or v_checkout_before<>(select md5(row_to_json(c)::text) from public.billing_checkout_sessions c where id=v_case.checkout_id) then
    raise exception 'EVENT_FACTS_IDENTITY_CONFLICT_INVALID';
  end if;

  for v_case in
    select * from (values
      ('stripe'::text,'test'::text,null::text,null::text,'provider-other','4'),
      ('lemonsqueezy','live',null,null,'environment-other','5'),
      ('lemonsqueezy','test','customer-other',null,'customer-other-event','6'),
      ('lemonsqueezy','test',null,'subscription-other','subscription-other-event','7')
    ) as cases(provider,environment,customer_id,subscription_id,event_subscription_id,hash_character)
  loop
    update public.subscriptions
    set status='past_due',billing_provider=v_case.provider,billing_environment=v_case.environment,
        provider_customer_id=v_case.customer_id,
        provider_subscription_id=v_case.subscription_id,
        provider_state_updated_at=null,provider_last_webhook_event_id=null
    where id=v_subscription;
    select * into v_case from pg_temp.make_processor_case(
      v_owner,v_salon,v_starter,v_case.event_subscription_id,
      v_case.event_subscription_id,'customer-contract',v_case.hash_character);
    select md5(row_to_json(s)::text) into v_subscription_before from public.subscriptions s where id=v_subscription;
    select md5(row_to_json(c)::text) into v_checkout_before from public.billing_checkout_sessions c where id=v_case.checkout_id;
    select outcome,error_code into v_outcome,v_error
    from public.process_billing_subscription_created_v1(v_case.event_id,'2026-07-28T12:00:00Z');
    if v_outcome<>'manual_review' or v_error<>'processor_provider_ownership_conflict'
       or v_subscription_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_subscription)
       or v_checkout_before<>(select md5(row_to_json(c)::text) from public.billing_checkout_sessions c where id=v_case.checkout_id) then
      raise exception 'PROVIDER_OWNERSHIP_CONFLICT_INVALID';
    end if;
  end loop;

  update public.subscriptions set status='active',billing_provider=null,billing_environment=null,
    provider_customer_id=null,provider_subscription_id=null,
    provider_state_updated_at=null,provider_last_webhook_event_id=null
  where id=v_subscription;
  select * into v_case from pg_temp.make_processor_case(
    v_owner,v_salon,v_starter,'timestamp-invalid','timestamp-invalid',
    'customer-contract','8');
  update public.billing_webhook_subscription_facts
  set provider_updated_at='2026-07-28T09:59:59Z'
  where webhook_event_id=v_case.event_id;
  select md5(row_to_json(s)::text) into v_subscription_before from public.subscriptions s where id=v_subscription;
  select md5(row_to_json(c)::text) into v_checkout_before from public.billing_checkout_sessions c where id=v_case.checkout_id;
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_created_v1(v_case.event_id,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_provider_state_unsupported'
     or v_subscription_before<>(select md5(row_to_json(s)::text) from public.subscriptions s where id=v_subscription)
     or v_checkout_before<>(select md5(row_to_json(c)::text) from public.billing_checkout_sessions c where id=v_case.checkout_id) then
    raise exception 'PROVIDER_TIMESTAMP_CONTRACT_INVALID';
  end if;

  if has_table_privilege('anon','public.billing_webhook_subscription_facts','select')
     or has_table_privilege('authenticated','public.billing_webhook_subscription_facts','select') then
    raise exception 'FACTS_BROWSER_ACCESS_ALLOWED';
  end if;
end;
$$;

rollback;

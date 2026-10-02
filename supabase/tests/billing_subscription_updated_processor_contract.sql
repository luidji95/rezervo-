\set ON_ERROR_STOP on
begin;

create function pg_temp.make_updated_event(
  p_subscription_id text,
  p_status text,
  p_updated_at timestamptz,
  p_renews_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_cancelled boolean default false,
  p_trial_ends_at timestamptz default null,
  p_pause_mode text default null,
  p_pause_resumes_at timestamptz default null,
  p_customer_id text default 'customer-updated',
  p_store_id text default '440512',
  p_product_id text default 'product-starter',
  p_variant_id text default 'variant-starter',
  p_object_id text default null
)
returns uuid
language plpgsql
as $$
declare
  v_event_id uuid;
  v_nonce text := gen_random_uuid()::text;
begin
  select event_id into v_event_id
  from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_updated','subscriptions',
    coalesce(p_object_id,p_subscription_id),
    md5('raw-'||v_nonce)||md5('raw2-'||v_nonce),
    md5('semantic-'||v_nonce)||md5('semantic2-'||v_nonce),
    'received',null,true,
    gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    p_subscription_id,'order-updated',p_customer_id,p_product_id,p_variant_id,
    p_status,'2026-07-28T10:00:00Z',p_updated_at,true,'ready',null,
    p_store_id,p_renews_at,p_ends_at,p_cancelled,p_trial_ends_at,
    p_pause_mode,p_pause_resumes_at
  );
  return v_event_id;
end;
$$;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_salon uuid := gen_random_uuid();
  v_subscription uuid;
  v_starter uuid;
  v_pro uuid;
  v_event uuid;
  v_outcome text;
  v_error text;
  v_period_start timestamptz := '2026-07-28T10:00:00Z';
  v_old_period_end timestamptz := '2026-08-01T10:00:00Z';
  v_checkout_fingerprint text;
  v_subscription_fingerprint text;
  v_plan_before uuid;
  v_override_id uuid;
begin
  if to_regprocedure('public.process_billing_subscription_updated_v1(uuid,timestamptz)') is null then
    raise exception 'UPDATED_PROCESSOR_MISSING';
  end if;
  if has_function_privilege('public','public.process_billing_subscription_updated_v1(uuid,timestamptz)','execute')
     or has_function_privilege('anon','public.process_billing_subscription_updated_v1(uuid,timestamptz)','execute')
     or has_function_privilege('authenticated','public.process_billing_subscription_updated_v1(uuid,timestamptz)','execute')
     or not has_function_privilege('service_role','public.process_billing_subscription_updated_v1(uuid,timestamptz)','execute') then
    raise exception 'UPDATED_PROCESSOR_GRANTS_INVALID';
  end if;
  if (select prosecdef is not true or proconfig<>array['search_path=""']
      from pg_proc where oid='public.process_billing_subscription_updated_v1(uuid,timestamptz)'::regprocedure) then
    raise exception 'UPDATED_PROCESSOR_SECURITY_INVALID';
  end if;

  select id into v_starter from public.plans where slug='starter';
  select id into v_pro from public.plans where slug='pro';
  insert into public.billing_provider_prices(
    plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active
  ) values
    (v_starter,'lemonsqueezy','test','monthly','RSD',2990,
     'product-starter','variant-starter','440512',true),
    (v_pro,'lemonsqueezy','test','monthly','RSD',5990,
     'product-pro','variant-pro','440512',true)
  on conflict (provider,environment,plan_id,billing_interval,currency)
  do update set provider_product_id=excluded.provider_product_id,
    provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=true;

  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Updated processor contract','updated-'||substr(v_salon::text,1,8));
  select id into v_subscription from public.subscriptions where salon_id=v_salon;
  update public.subscriptions
  set plan_id=v_starter,status='active',billing_provider='lemonsqueezy',
      billing_environment='test',provider_customer_id='customer-updated',
      provider_subscription_id='subscription-updated',
      current_period_starts_at=v_period_start,
      current_period_ends_at=v_old_period_end,
      provider_state_updated_at='2026-07-28T10:01:00Z'
  where id=v_subscription;
  select plan_id into v_plan_before from public.subscriptions where id=v_subscription;
  select md5(coalesce(string_agg(row_to_json(c)::text,'|' order by c.id),''))
    into v_checkout_fingerprint from public.billing_checkout_sessions c;
  insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,enabled)
  values(v_salon,v_pro,'pilot','updated processor contract',true)
  returning id into v_override_id;

  -- Active renewal preserves period start and restores active access.
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:02:00Z','2026-08-28T10:00:00Z'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'processed' or v_error is not null or not exists(
    select 1 from public.subscriptions where id=v_subscription and status='active'
      and current_period_starts_at=v_period_start
      and current_period_ends_at='2026-08-28T10:00:00Z'
      and provider_last_webhook_event_id=v_event
  ) then raise exception 'ACTIVE_RENEWAL_INVALID'; end if;

  select outcome into v_outcome
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:01:00Z');
  if v_outcome<>'already_processed' then raise exception 'UPDATED_RETRY_INVALID'; end if;

  -- Past due and unpaid are strict read-only and never extend the period.
  foreach v_error in array array['past_due','unpaid'] loop
    v_event := pg_temp.make_updated_event(
      'subscription-updated',v_error,
      case when v_error='past_due' then '2026-07-28T10:03:00Z'::timestamptz
           else '2026-07-28T10:04:00Z'::timestamptz end,
      '2026-09-28T10:00:00Z'
    );
    select outcome into v_outcome
    from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
    if v_outcome<>'processed' or not exists(
      select 1 from public.subscriptions where id=v_subscription and status='past_due'
        and current_period_ends_at='2026-08-28T10:00:00Z'
    ) then raise exception 'DELINQUENT_POLICY_INVALID'; end if;
  end loop;

  -- Active recovery and cancellation grace period.
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:05:00Z','2026-09-28T10:00:00Z'
  );
  perform * from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  v_event := pg_temp.make_updated_event(
    'subscription-updated','cancelled','2026-07-28T10:06:00Z',null,
    '2026-09-28T10:00:00Z',true
  );
  perform * from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if not exists(
    select 1 from public.subscriptions where id=v_subscription and status='cancelled'
      and cancel_at_period_end and current_period_ends_at='2026-09-28T10:00:00Z'
      and cancelled_at='2026-07-28T10:06:00Z'
  ) or not exists(
    select 1 from public.resolve_salon_access_v1(v_salon,'2026-08-01T00:00:00Z')
    where has_full_access
  ) or exists(
    select 1 from public.resolve_salon_access_v1(v_salon,'2026-10-01T00:00:00Z')
    where has_full_access and access_source='subscription'
  ) then raise exception 'CANCELLED_GRACE_INVALID'; end if;

  -- Stale and equal-timestamp events are deterministic.
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:05:30Z','2026-10-28T10:00:00Z'
  );
  select outcome into v_outcome
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'stale_ignored' then raise exception 'STALE_EVENT_INVALID'; end if;

  v_event := pg_temp.make_updated_event(
    'subscription-updated','cancelled','2026-07-28T10:06:00Z',null,
    '2026-09-28T10:00:00Z',true
  );
  select outcome into v_outcome
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'already_applied' then raise exception 'SAME_TIMESTAMP_NOOP_INVALID'; end if;

  v_event := pg_temp.make_updated_event(
    'subscription-updated','cancelled','2026-07-28T10:06:00Z',null,
    '2026-10-28T10:00:00Z',true
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_updated_same_timestamp_conflict' then
    raise exception 'SAME_TIMESTAMP_CONFLICT_INVALID';
  end if;

  -- Unsupported provider states and plan changes never mutate the subscription.
  foreach v_error in array array['pause','trial','unknown','plan_change'] loop
    if v_error='pause' then
      v_event := pg_temp.make_updated_event('subscription-updated','active','2026-07-28T10:07:00Z',
        '2026-10-28T10:00:00Z',null,false,null,'free');
    elsif v_error='trial' then
      v_event := pg_temp.make_updated_event('subscription-updated','on_trial','2026-07-28T10:07:00Z',
        '2026-10-28T10:00:00Z',null,false,'2026-08-10T00:00:00Z');
    elsif v_error='plan_change' then
      v_event := pg_temp.make_updated_event('subscription-updated','active','2026-07-28T10:07:00Z',
        '2026-10-28T10:00:00Z',null,false,null,null,null,
        'customer-updated','440512','product-pro','variant-pro');
    else
      v_event := pg_temp.make_updated_event('subscription-updated','mystery','2026-07-28T10:07:00Z');
    end if;
    select outcome into v_outcome
    from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
    if v_outcome<>'manual_review' then raise exception 'UNSUPPORTED_STATE_NOT_REVIEWED'; end if;
  end loop;

  -- Unknown link waits only for a received subscription_created dependency.
  v_event := pg_temp.make_updated_event('unknown-subscription','active','2026-07-28T10:07:00Z',
    '2026-10-28T10:00:00Z');
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_updated_subscription_unknown' then
    raise exception 'UNKNOWN_SUBSCRIPTION_INVALID';
  end if;

  -- A received subscription_created for the same provider identity is retryable.
  perform * from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions','dependency-subscription',
    md5('created-dependency-raw')||md5('created-dependency-raw-2'),
    md5('created-dependency-semantic')||md5('created-dependency-semantic-2'),
    'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    'dependency-subscription','dependency-order','customer-updated',
    'product-starter','variant-starter','active',
    '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,'ready',null,
    '440512','2026-08-28T10:00:00Z',null,false,null,null,null
  );
  v_event := pg_temp.make_updated_event(
    'dependency-subscription','active','2026-07-28T10:02:00Z','2026-08-28T10:00:00Z'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'dependency_pending'
     or v_error<>'processor_updated_created_dependency_pending'
     or not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='received') then
    raise exception 'CREATED_DEPENDENCY_INVALID';
  end if;

  -- Identity and ownership conflicts are terminal review outcomes.
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:07:00Z','2026-10-28T10:00:00Z',
    null,false,null,null,null,'other-customer'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_updated_provider_ownership_conflict' then
    raise exception 'CUSTOMER_CONFLICT_INVALID';
  end if;
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:07:00Z','2026-10-28T10:00:00Z',
    null,false,null,null,null,'customer-updated','other-store'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review' or v_error<>'processor_updated_provider_mapping_invalid' then
    raise exception 'STORE_CONFLICT_INVALID';
  end if;
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:07:00Z','2026-10-28T10:00:00Z',
    null,false,null,null,null,'customer-updated','440512','product-starter','variant-starter',
    'other-envelope-id'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review'
     or v_error<>'processor_updated_event_facts_identity_conflict' then
    raise exception 'UPDATED_EVENT_FACTS_IDENTITY_INVALID';
  end if;

  -- A valid local plan without an active mapping is a mapping error, not a plan error.
  update public.billing_provider_prices
  set is_active=false
  where provider='lemonsqueezy' and environment='test'
    and plan_id=v_starter and billing_interval='monthly';
  select md5(row_to_json(s)::text) into v_subscription_fingerprint
  from public.subscriptions s where id=v_subscription;
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:07:00Z','2026-10-28T10:00:00Z'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review'
     or v_error<>'processor_updated_provider_mapping_invalid'
     or v_subscription_fingerprint<>(select md5(row_to_json(s)::text)
       from public.subscriptions s where id=v_subscription) then
    raise exception 'MISSING_MAPPING_CLASSIFICATION_INVALID';
  end if;
  update public.billing_provider_prices
  set is_active=true
  where provider='lemonsqueezy' and environment='test'
    and plan_id=v_starter and billing_interval='monthly';

  -- Stale provider state is ignored before pause/trial/status interpretation.
  update public.subscriptions
  set provider_state_updated_at='2026-07-28T10:10:00Z'
  where id=v_subscription;
  select md5(row_to_json(s)::text) into v_subscription_fingerprint
  from public.subscriptions s where id=v_subscription;
  foreach v_error in array array['stale_pause','stale_unknown'] loop
    if v_error='stale_pause' then
      v_event := pg_temp.make_updated_event(
        'subscription-updated','active','2026-07-28T10:09:00Z',
        '2026-10-28T10:00:00Z',null,false,null,'free'
      );
    else
      v_event := pg_temp.make_updated_event(
        'subscription-updated','unsupported_state','2026-07-28T10:09:00Z'
      );
    end if;
    select outcome,error_code into v_outcome,v_error
    from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
    if v_outcome<>'stale_ignored' or v_error is not null
       or not exists(select 1 from public.billing_webhook_events
         where id=v_event and processing_status='processed' and error_code is null)
       or v_subscription_fingerprint<>(select md5(row_to_json(s)::text)
         from public.subscriptions s where id=v_subscription) then
      raise exception 'STALE_UNSUPPORTED_STATE_INVALID';
    end if;
  end loop;

  -- Expiration removes subscription access and cannot be silently reactivated.
  v_event := pg_temp.make_updated_event(
    'subscription-updated','expired','2026-07-28T10:11:00Z',null,
    '2026-07-28T10:10:30Z',true
  );
  select outcome into v_outcome
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'processed' or not exists(
    select 1 from public.subscriptions where id=v_subscription and status='expired'
      and current_period_ends_at='2026-07-28T10:10:30Z'
  ) then raise exception 'EXPIRED_STATE_INVALID'; end if;

  select md5(row_to_json(s)::text) into v_subscription_fingerprint
  from public.subscriptions s where id=v_subscription;
  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:10:45Z','2026-10-28T10:00:00Z'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'stale_ignored' or v_error is not null
     or v_subscription_fingerprint<>(select md5(row_to_json(s)::text)
       from public.subscriptions s where id=v_subscription) then
    raise exception 'STALE_EXPIRED_REACTIVATION_INVALID';
  end if;

  v_event := pg_temp.make_updated_event(
    'subscription-updated','active','2026-07-28T10:12:00Z','2026-10-28T10:00:00Z'
  );
  select outcome,error_code into v_outcome,v_error
  from public.process_billing_subscription_updated_v1(v_event,'2026-07-28T12:00:00Z');
  if v_outcome<>'manual_review'
     or v_error<>'processor_updated_expired_reactivation_unsupported' then
    raise exception 'EXPIRED_REACTIVATION_INVALID';
  end if;

  if v_plan_before<>(select plan_id from public.subscriptions where id=v_subscription)
     or v_checkout_fingerprint<>(select md5(coalesce(string_agg(row_to_json(c)::text,'|' order by c.id),'')) from public.billing_checkout_sessions c)
     or not exists(select 1 from public.billing_access_overrides where id=v_override_id and enabled) then
    raise exception 'PROTECTED_BILLING_STATE_CHANGED';
  end if;
end;
$$;

rollback;

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions'
      and column_name = 'billing_environment' and is_nullable = 'YES'
  ) then raise exception 'BILLING_ENVIRONMENT_COLUMN_MISSING'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_checkout_sessions'
      and column_name = 'provider_order_id' and is_nullable = 'YES'
  ) then raise exception 'PROVIDER_ORDER_COLUMN_MISSING'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_checkout_sessions'
      and column_name = 'resulting_subscription_id' and is_nullable = 'YES'
  ) then raise exception 'RESULTING_SUBSCRIPTION_COLUMN_MISSING'; end if;
  if to_regclass('public.subscriptions_provider_subscription_unique') is null
     or to_regclass('public.billing_checkout_sessions_provider_order_unique') is null
     or to_regclass('public.billing_checkout_sessions_resulting_subscription_idx') is null then
    raise exception 'CORRELATION_INDEX_MISSING';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.billing_checkout_sessions'::regclass
      and conname = 'billing_checkout_sessions_resulting_subscription_id_fkey'
  ) then raise exception 'RESULTING_SUBSCRIPTION_FK_MISSING'; end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname = 'subscriptions_provider_metadata_consistent'
      and pg_get_constraintdef(oid) ilike '%billing_environment IS NOT NULL%'
  ) then raise exception 'PROVIDER_ENVIRONMENT_NOT_NULL_CONTRACT_MISSING'; end if;
end;
$$;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_salon_a uuid := gen_random_uuid();
  v_salon_b uuid := gen_random_uuid();
  v_subscription_a uuid;
  v_subscription_b uuid;
  v_plan uuid;
  v_rejected boolean;
  v_before_policies bigint;
  v_before_anon_acl boolean;
  v_before_authenticated_acl boolean;
begin
  select id into v_plan from public.plans where slug = 'pro';
  select count(*) into v_before_policies
  from pg_policies where schemaname = 'public' and tablename = 'billing_checkout_sessions';
  select has_table_privilege('anon', 'public.billing_checkout_sessions', 'select,insert,update,delete')
    into v_before_anon_acl;
  select has_table_privilege('authenticated', 'public.billing_checkout_sessions', 'select,insert,update,delete')
    into v_before_authenticated_acl;

  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values
    (v_owner, concat(v_owner, '@example.invalid'), '{}', '{}'),
    (v_owner_b, concat(v_owner_b, '@example.invalid'), '{}', '{}');
  insert into public.salons(id,owner_id,name,slug)
  values
    (v_salon_a,v_owner,'Correlation A',concat('correlation-a-',replace(v_salon_a::text,'-',''))),
    (v_salon_b,v_owner_b,'Correlation B',concat('correlation-b-',replace(v_salon_b::text,'-','')));
  select id into v_subscription_a from public.subscriptions where salon_id = v_salon_a;
  select id into v_subscription_b from public.subscriptions where salon_id = v_salon_b;

  update public.subscriptions
  set billing_provider = null, billing_environment = null,
      provider_customer_id = null, provider_subscription_id = null
  where id = v_subscription_a;

  update public.subscriptions
  set billing_provider = 'lemonsqueezy', billing_environment = 'test',
      provider_customer_id = 'shared-customer', provider_subscription_id = 'subscription-shared'
  where id = v_subscription_a;
  update public.subscriptions
  set billing_provider = 'lemonsqueezy', billing_environment = 'live',
      provider_customer_id = 'shared-customer', provider_subscription_id = 'subscription-shared'
  where id = v_subscription_b;

  v_rejected := false;
  begin
    update public.subscriptions set billing_environment = 'invalid' where id = v_subscription_a;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'INVALID_BILLING_ENVIRONMENT_ALLOWED'; end if;

  v_rejected := false;
  begin
    update public.subscriptions
    set billing_provider = null, billing_environment = 'test', provider_customer_id = null,
        provider_subscription_id = null where id = v_subscription_a;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'ENVIRONMENT_WITHOUT_PROVIDER_ALLOWED'; end if;

  v_rejected := false;
  begin
    update public.subscriptions
    set billing_provider = 'lemonsqueezy', billing_environment = null,
        provider_customer_id = null, provider_subscription_id = null
    where id = v_subscription_a;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'PROVIDER_WITHOUT_ENVIRONMENT_ALLOWED'; end if;

  v_rejected := false;
  begin
    update public.subscriptions
    set billing_provider = null, billing_environment = 'live', provider_customer_id = null,
        provider_subscription_id = null where id = v_subscription_a;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'LIVE_ENVIRONMENT_WITHOUT_PROVIDER_ALLOWED'; end if;

  v_rejected := false;
  begin
    update public.subscriptions
    set billing_provider = 'lemonsqueezy', billing_environment = 'test',
        provider_customer_id = 'shared-customer', provider_subscription_id = 'subscription-shared'
    where id = v_subscription_b;
  exception when unique_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'DUPLICATE_PROVIDER_SUBSCRIPTION_ALLOWED'; end if;

  update public.subscriptions
  set billing_environment = 'test', provider_customer_id = 'shared-customer',
      provider_subscription_id = 'subscription-other'
  where id = v_subscription_b;

  update public.subscriptions
  set billing_provider = null, billing_environment = null, provider_customer_id = null,
      provider_subscription_id = null where id in (v_subscription_a, v_subscription_b);

  insert into public.billing_checkout_sessions(
    salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,
    provider_order_id,resulting_subscription_id
  ) values (
    v_salon_a,v_owner,v_plan,'lemonsqueezy','test',gen_random_uuid(),
    'order-shared',v_subscription_a
  );

  v_rejected := false;
  begin
    insert into public.billing_checkout_sessions(
      salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,
      provider_order_id,resulting_subscription_id
    ) values (
      v_salon_b,v_owner_b,v_plan,'lemonsqueezy','test',gen_random_uuid(),
      'order-shared',v_subscription_b
    );
  exception when unique_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'DUPLICATE_PROVIDER_ORDER_ALLOWED'; end if;

  v_rejected := false;
  begin
    insert into public.billing_checkout_sessions(
      salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,
      resulting_subscription_id
    ) values (
      v_salon_a,v_owner,v_plan,'lemonsqueezy','test',gen_random_uuid(),gen_random_uuid()
    );
  exception when foreign_key_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'UNKNOWN_RESULTING_SUBSCRIPTION_ALLOWED'; end if;

  insert into public.billing_checkout_sessions(
    salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key
  ) values (v_salon_b,v_owner_b,v_plan,'lemonsqueezy','test',gen_random_uuid());

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'billing_checkout_sessions') <> v_before_policies
     or has_table_privilege('anon', 'public.billing_checkout_sessions', 'select,insert,update,delete') <> v_before_anon_acl
     or has_table_privilege('authenticated', 'public.billing_checkout_sessions', 'select,insert,update,delete') <> v_before_authenticated_acl then
    raise exception 'CHECKOUT_RLS_OR_GRANTS_CHANGED';
  end if;
end;
$$;

rollback;

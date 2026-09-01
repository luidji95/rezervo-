begin;

create or replace function public.acquire_billing_checkout_intent_v2(
  p_salon_id uuid,
  p_actor_profile_id uuid,
  p_requested_plan_id uuid,
  p_provider text
)
returns table(
  acquisition_outcome text,
  checkout_session_id uuid,
  idempotency_key uuid,
  status text,
  requested_plan_id uuid,
  actor_profile_id uuid,
  provider text,
  environment text,
  provider_session_id text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_checkout public.billing_checkout_sessions%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_environment text;
  v_runtime_config_count integer;
  v_subscription_count integer;
  v_iteration integer;
  v_now timestamptz;
  v_created boolean := false;
begin
  if p_salon_id is null or p_actor_profile_id is null
     or p_requested_plan_id is null or p_provider is null then
    raise exception using errcode='22004', message='BILLING_CHECKOUT_INTENT_ARGUMENT_REQUIRED';
  end if;
  if p_provider <> 'lemonsqueezy' then
    raise exception using errcode='22023', message='BILLING_CHECKOUT_INTENT_PROVIDER_INVALID';
  end if;

  select pg_catalog.count(*), pg_catalog.min(c.environment)
    into v_runtime_config_count, v_environment
  from private.billing_runtime_config c;
  if v_runtime_config_count <> 1 or v_environment not in ('test','live') then
    raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_RUNTIME_CONFIG';
  end if;
  if not exists (select 1 from public.salons s where s.id=p_salon_id)
     or not exists (select 1 from public.profiles p where p.id=p_actor_profile_id)
     or not exists (select 1 from public.plans p where p.id=p_requested_plan_id) then
    raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_ACQUIRE_IDENTITY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'billing-checkout-intent:' || p_provider || ':' || v_environment || ':' || p_salon_id::text,
      0
    )
  );
  v_now := pg_catalog.clock_timestamp();

  perform 1
  from public.billing_checkout_sessions c
  where c.salon_id=p_salon_id and c.provider=p_provider
    and c.environment=v_environment and c.status in ('creating','open','completed')
  order by c.created_at,c.id
  for update;

  if exists (
    select 1 from public.billing_checkout_sessions c
    where c.salon_id=p_salon_id and c.provider=p_provider
      and c.environment=v_environment and c.status='completed'
  ) then
    raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_COMPLETED_CHECKOUT';
  end if;

  update public.billing_checkout_sessions c
  set status='expired', updated_at=v_now
  where c.salon_id=p_salon_id and c.provider=p_provider
    and c.environment=v_environment and c.status='open'
    and c.expires_at is not null and c.expires_at<=v_now;

  for v_iteration in 1..4 loop
    v_checkout := null;
    insert into public.billing_checkout_sessions(
      salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status
    ) values (
      p_salon_id,p_actor_profile_id,p_requested_plan_id,p_provider,v_environment,
      extensions.gen_random_uuid(),'creating'
    )
    on conflict (provider,environment,salon_id)
      where status in ('creating','open') do nothing
    returning * into v_checkout;

    if found then
      v_created := true;
    else
      select c.* into v_checkout
      from public.billing_checkout_sessions c
      where c.provider=p_provider and c.environment=v_environment
        and c.salon_id=p_salon_id and c.status in ('creating','open')
      for update;
    end if;
    exit when v_checkout.id is not null;
  end loop;
  if v_checkout.id is null then
    raise exception using errcode='40001', message='BILLING_CHECKOUT_INTENT_ACQUIRE_RETRY_EXHAUSTED';
  end if;

  select pg_catalog.count(*) into v_subscription_count
  from public.subscriptions s where s.salon_id=p_salon_id;
  if v_subscription_count <> 1 then
    raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_SUBSCRIPTION_CARDINALITY';
  end if;
  select s.* into strict v_subscription
  from public.subscriptions s where s.salon_id=p_salon_id
  for update;
  select p.* into v_plan from public.plans p where p.id=v_subscription.plan_id for share;

  if v_subscription.billing_provider is null
     and v_subscription.billing_environment is null
     and v_subscription.provider_customer_id is null
     and v_subscription.provider_subscription_id is null then
    if v_subscription.status <> 'trialing'::public.subscription_status
       or v_plan.id is null or v_plan.slug <> 'pro'
       or v_subscription.trial_starts_at is null or v_subscription.trial_ends_at is null
       or v_subscription.trial_ends_at <= v_subscription.trial_starts_at then
      raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_LOCAL_SUBSCRIPTION';
    end if;
  elsif v_subscription.billing_provider is distinct from 'lemonsqueezy'
     or v_subscription.billing_environment is null
     or v_subscription.billing_environment not in ('test','live')
     or v_subscription.billing_environment is distinct from v_environment
     or v_subscription.provider_customer_id is null
     or not (v_subscription.provider_customer_id ~ '[^[:space:]]')
     or v_subscription.provider_subscription_id is null
     or not (v_subscription.provider_subscription_id ~ '[^[:space:]]') then
    raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_PROVIDER_METADATA';
  elsif v_subscription.status='past_due'::public.subscription_status then
    raise exception using errcode='P0001', message='BILLING_SUBSCRIPTION_PAYMENT_REQUIRED';
  elsif v_subscription.status='expired'::public.subscription_status
     or (v_subscription.status='cancelled'::public.subscription_status
         and (v_subscription.current_period_ends_at is null or v_subscription.current_period_ends_at<=v_now)) then
    raise exception using errcode='P0001', message='BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED';
  elsif v_subscription.status in (
      'active'::public.subscription_status,
      'trialing'::public.subscription_status,
      'cancelled'::public.subscription_status
    ) then
    raise exception using errcode='P0001', message='BILLING_SUBSCRIPTION_ALREADY_ACTIVE';
  else
    raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_SUBSCRIPTION_STATUS';
  end if;

  return query select
    case when v_created then 'created' else 'existing' end::text,
    v_checkout.id,v_checkout.idempotency_key,v_checkout.status::text,
    v_checkout.requested_plan_id,v_checkout.actor_profile_id,
    v_checkout.provider,v_checkout.environment,v_checkout.provider_session_id,v_checkout.expires_at;
end;
$$;

alter function public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)
  to service_role;

comment on function public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text) is
  'Service-role atomic checkout acquisition guarded by the DB-owned environment and a locked provider-free onboarding subscription.';

commit;

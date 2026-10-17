begin;

-- C1: employee capacity protection for the first purchase after the internal trial,
-- plus the narrow operator recovery for capacity-blocked or late created activations.
--
-- Lock protocol (all writers): [D: webhook event] -> event -> facts -> checkout rows
-- (salon, ordered by created_at, id) -> plan (FOR SHARE) -> subscription (FOR UPDATE)
-- -> employee-capacity advisory lock. The employee trigger takes only the capacity lock
-- after its own employee row, and reads checkout/subscription/plan state without locks,
-- so no writer waits for a lock in the opposite order. See docs/employee-capacity-contract.md.

-- ---------------------------------------------------------------------------
-- Effective employee capacity: plan/override limit, narrowed by a pending checkout.
-- ---------------------------------------------------------------------------

create function public.resolve_employee_capacity_v2(
  p_salon_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  has_full_access boolean,
  access_reason text,
  effective_plan_id uuid,
  effective_plan_slug text,
  plan_max_employees integer,
  max_employees integer,
  capacity_reason text,
  pending_checkout_id uuid,
  pending_plan_slug text,
  pending_max_employees integer,
  access_source text,
  is_legacy_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select * from public.resolve_employee_capacity_v1(p_salon_id, p_now)
  ),
  pending as (
    -- Status, not expiry, decides: creating/open checkouts are exactly the ones the
    -- created processor (directly or after recovery finalization) can still activate.
    select c.id, p.slug, p.max_employees
    from public.billing_checkout_sessions c
    join public.plans p on p.id = c.requested_plan_id
    where c.salon_id = p_salon_id
      and c.status in ('creating', 'open')
      and p.max_employees is not null
    order by p.max_employees, c.created_at, c.id
    limit 1
  )
  select b.has_full_access, b.access_reason, b.effective_plan_id, b.effective_plan_slug,
    b.max_employees,
    case when pending.id is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.max_employees else b.max_employees end,
    case when pending.id is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
        then 'pending_checkout'
      when b.access_source = 'billing_override' then 'override'
      else 'plan' end,
    case when pending.id is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.id end,
    case when pending.id is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.slug end,
    case when pending.id is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.max_employees end,
    b.access_source, b.is_legacy_active
  from base b
  left join pending on true;
$$;

alter function public.resolve_employee_capacity_v2(uuid, timestamptz) owner to postgres;
revoke all on function public.resolve_employee_capacity_v2(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_employee_capacity_v2(uuid, timestamptz) to service_role;
comment on function public.resolve_employee_capacity_v2(uuid, timestamptz) is
  'Canonical effective employee capacity: plan or override limit, narrowed to the target limit of a creating/open checkout regardless of its expiry. Access and other capabilities stay with resolve_salon_access_v1.';

create or replace function public.enforce_employee_capacity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity record;
  v_active_count integer;
begin
  if new.is_active = true and (
    tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.is_active = false)
  ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('rezervo:employee-capacity:' || new.salon_id::text, 0)
    );

    -- READ COMMITTED: this statement takes a fresh snapshot after the advisory lock,
    -- so a checkout or activation committed by the previous lock holder is visible.
    select * into v_capacity
    from public.resolve_employee_capacity_v2(new.salon_id, pg_catalog.now());

    if v_capacity.effective_plan_id is null then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_ENTITLEMENT_NOT_CONFIGURED';
    end if;
    if not v_capacity.has_full_access then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_ACCESS_REQUIRED';
    end if;

    if v_capacity.max_employees is not null then
      select count(*) into v_active_count
      from public.employees e
      where e.salon_id = new.salon_id and e.is_active = true;
      if v_active_count >= v_capacity.max_employees then
        raise exception using errcode = 'P0001', message = case
          when v_capacity.capacity_reason = 'pending_checkout' then 'EMPLOYEE_PURCHASE_LIMIT_PENDING'
          else 'EMPLOYEE_LIMIT_REACHED' end;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recognised, unresolved previous activation (durable signed created event).
-- ---------------------------------------------------------------------------

create function public.resolve_billing_purchase_activation_v1(p_salon_id uuid)
returns table (
  webhook_event_id uuid,
  checkout_session_id uuid,
  pending_reason text,
  target_plan_slug text,
  target_max_employees integer,
  payment_confirmed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, f.checkout_session_id,
    case when e.processing_status = 'received' then 'processing'
      when e.error_code = 'processor_checkout_capacity_exceeded' then 'capacity'
      else 'review' end,
    p.slug, p.max_employees,
    exists (
      select 1 from public.billing_webhook_subscription_invoice_facts i
      where i.provider = 'lemonsqueezy' and i.environment = e.environment
        and i.provider_subscription_id = f.provider_subscription_id
        and i.billing_reason = 'initial' and i.invoice_status = 'paid'
    )
  from public.billing_webhook_events e
  join public.billing_webhook_subscription_facts f on f.webhook_event_id = e.id
  left join public.plans p on p.slug = f.custom_plan_code
  where e.provider = 'lemonsqueezy'
    and e.event_name = 'subscription_created'
    and f.custom_salon_id = p_salon_id
    and (
      e.processing_status = 'received'
      or (e.processing_status = 'manual_review' and e.error_code in (
        'processor_checkout_capacity_exceeded',
        'processor_checkout_state_invalid',
        'processor_retry_exhausted'))
    )
  order by e.received_at desc, e.id
  limit 1;
$$;

alter function public.resolve_billing_purchase_activation_v1(uuid) owner to postgres;
revoke all on function public.resolve_billing_purchase_activation_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_billing_purchase_activation_v1(uuid) to service_role;
comment on function public.resolve_billing_purchase_activation_v1(uuid) is
  'Read-only: the latest signed subscription_created event for a salon that has not been activated (still received, or parked for capacity, expired checkout or retry exhaustion). payment_confirmed only when a paid initial invoice for the same provider subscription is recorded.';

create index if not exists billing_webhook_subscription_facts_custom_salon_idx
  on public.billing_webhook_subscription_facts(custom_salon_id)
  where custom_salon_id is not null;

-- ---------------------------------------------------------------------------
-- Acquisition: target-capacity precondition and pending-activation guard.
-- ---------------------------------------------------------------------------

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
  v_completed_checkout_exists boolean := false;
  v_active_employees integer;
  v_target_max_employees integer;
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

  select exists (
    select 1 from public.billing_checkout_sessions c
    where c.salon_id=p_salon_id and c.provider=p_provider
      and c.environment=v_environment and c.status='completed'
  ) into v_completed_checkout_exists;

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
    if v_completed_checkout_exists then
      raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_COMPLETED_CHECKOUT';
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

  -- C1: a recognised, unresolved previous activation blocks a new purchase; this also keeps
  -- that purchase's open checkout from being replaced below.
  if exists (select 1 from public.resolve_billing_purchase_activation_v1(p_salon_id)) then
    raise exception using errcode='P0001', message='BILLING_PURCHASE_ACTIVATION_PENDING';
  end if;

  -- C1: target-capacity precondition. The capacity lock is the last lock taken, after the
  -- checkout rows, the subscription and the plan, matching every other writer.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rezervo:employee-capacity:' || p_salon_id::text, 0)
  );
  select p.max_employees into v_target_max_employees
  from public.plans p where p.id=p_requested_plan_id;
  select pg_catalog.count(*) into v_active_employees
  from public.employees e where e.salon_id=p_salon_id and e.is_active=true;
  if v_target_max_employees is not null and v_active_employees > v_target_max_employees then
    raise exception using errcode='P0001', message='EMPLOYEE_OVER_TARGET_LIMIT';
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

  return query select
    case when v_created then 'created' else 'existing' end::text,
    v_checkout.id,v_checkout.idempotency_key,v_checkout.status::text,
    v_checkout.requested_plan_id,v_checkout.actor_profile_id,
    v_checkout.provider,v_checkout.environment,v_checkout.provider_session_id,v_checkout.expires_at;
end;
$$;

comment on function public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text) is
  'Service-role atomic checkout acquisition: checkout rows, subscription, plan, then the employee-capacity lock. Rejects a target plan below the active employee count and any new purchase while a recognised previous activation is unresolved.';

-- ---------------------------------------------------------------------------
-- Created activation: final atomic target-capacity check; salon correlation on parking.
-- ---------------------------------------------------------------------------

create or replace function public.process_billing_subscription_created_v2(
  p_webhook_event_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table(outcome text, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.billing_webhook_events%rowtype;
  v_facts public.billing_webhook_subscription_facts%rowtype;
  v_checkout public.billing_checkout_sessions%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_mapping_count integer := 0;
  v_conflict boolean;
  v_active_employees integer;
begin
  if p_now is null then
    raise exception using errcode='22004', message='BILLING_PROCESSOR_NOW_REQUIRED';
  end if;

  select * into v_event
  from public.billing_webhook_events
  where id = p_webhook_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BILLING_WEBHOOK_EVENT_NOT_FOUND';
  end if;
  if v_event.processing_status = 'processed' then
    return query select 'already_processed'::text, null::text;
    return;
  end if;
  if v_event.processing_status = 'manual_review' then
    return query select 'manual_review'::text, v_event.error_code;
    return;
  end if;
  if v_event.provider <> 'lemonsqueezy'
     or v_event.environment not in ('test', 'live')
     or v_event.event_name <> 'subscription_created'
     or v_event.provider_object_type <> 'subscriptions'
     or v_event.processing_status <> 'received' then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_event_contract_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_event_contract_invalid'::text;
    return;
  end if;

  select * into v_facts
  from public.billing_webhook_subscription_facts
  where webhook_event_id = v_event.id
  for update;

  if not found or v_facts.facts_schema_version <> 2
     or v_facts.correlation_status <> 'ready'
     or (v_event.environment = 'test' and v_facts.test_mode is distinct from true)
       or (v_event.environment = 'live' and v_facts.test_mode is distinct from false) then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_facts_contract_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_facts_contract_invalid'::text;
    return;
  end if;

  if v_event.provider_object_id is distinct from v_facts.provider_subscription_id then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_event_facts_identity_conflict', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_event_facts_identity_conflict'::text;
    return;
  end if;

  if v_facts.provider_status is distinct from 'active'
     or v_facts.provider_cancelled is distinct from false
     or v_facts.provider_ends_at is not null
     or v_facts.provider_trial_ends_at is not null
     or v_facts.provider_pause_mode is not null
     or v_facts.provider_pause_resumes_at is not null
     or v_facts.provider_renews_at is null
     or v_facts.provider_renews_at <= p_now
     or v_facts.provider_created_at is null
     or v_facts.provider_created_at >= v_facts.provider_renews_at
     or v_facts.provider_updated_at is null
     or v_facts.provider_updated_at < v_facts.provider_created_at
     or v_facts.provider_store_id is null
     or not (v_facts.provider_store_id ~ '[^[:space:]]')
     or v_facts.provider_customer_id is null
     or not (v_facts.provider_customer_id ~ '[^[:space:]]')
     or v_facts.provider_subscription_id is null
     or not (v_facts.provider_subscription_id ~ '[^[:space:]]')
     or v_facts.provider_order_id is null
     or not (v_facts.provider_order_id ~ '[^[:space:]]')
     or v_facts.provider_product_id is null
     or not (v_facts.provider_product_id ~ '[^[:space:]]')
     or v_facts.provider_variant_id is null
     or not (v_facts.provider_variant_id ~ '[^[:space:]]') then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_provider_state_unsupported', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_provider_state_unsupported'::text;
    return;
  end if;

  select * into v_checkout
  from public.billing_checkout_sessions
  where id = v_facts.checkout_session_id
  for update;

  if not found
     or v_checkout.provider <> 'lemonsqueezy'
     or v_checkout.environment is distinct from v_event.environment
     or v_checkout.salon_id is distinct from v_facts.custom_salon_id
     or v_checkout.idempotency_key is distinct from v_facts.custom_idempotency_key then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_checkout_correlation_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_checkout_correlation_invalid'::text;
    return;
  end if;

  select * into v_plan
  from public.plans
  where id = v_checkout.requested_plan_id
  for share;

  if not found or v_plan.slug not in ('starter','pro')
     or v_plan.slug is distinct from v_facts.custom_plan_code then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_plan_correlation_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_plan_correlation_invalid'::text;
    return;
  end if;

  perform 1
  from public.billing_provider_prices
  where provider='lemonsqueezy'
    and environment=v_event.environment
    and plan_id=v_checkout.requested_plan_id
    and billing_interval='monthly'
    and provider_store_id=v_facts.provider_store_id
    and provider_product_id=v_facts.provider_product_id
    and provider_variant_id=v_facts.provider_variant_id
  for share;
  get diagnostics v_mapping_count = row_count;

  if v_mapping_count<>1 then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_provider_mapping_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_provider_mapping_invalid'::text;
    return;
  end if;

  select * into v_subscription
  from public.subscriptions
  where salon_id=v_checkout.salon_id
  for update;

  if not found then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_subscription_not_found', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_subscription_not_found'::text;
    return;
  end if;

  select exists(
    select 1 from public.subscriptions s
    where s.billing_provider='lemonsqueezy'
      and s.billing_environment=v_event.environment
      and s.provider_subscription_id=v_facts.provider_subscription_id
      and s.id<>v_subscription.id
  ) or exists(
    select 1 from public.billing_checkout_sessions c
    where c.provider='lemonsqueezy' and c.environment=v_event.environment
      and c.provider_order_id=v_facts.provider_order_id
      and c.id<>v_checkout.id
  ) into v_conflict;

  if v_conflict
     or (v_subscription.billing_provider is not null
         and v_subscription.billing_provider<>'lemonsqueezy')
     or (v_subscription.billing_environment is not null
         and v_subscription.billing_environment is distinct from v_event.environment)
     or (v_subscription.provider_customer_id is not null
         and v_subscription.provider_customer_id<>v_facts.provider_customer_id)
     or (v_subscription.provider_subscription_id is not null
         and v_subscription.provider_subscription_id<>v_facts.provider_subscription_id) then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_provider_ownership_conflict', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_provider_ownership_conflict'::text;
    return;
  end if;

  if v_subscription.provider_state_updated_at is not null
     and v_facts.provider_updated_at < v_subscription.provider_state_updated_at then
    update public.billing_webhook_events
    set processing_status='processed', processed_at=p_now,
        error_code=null, updated_at=p_now
    where id=v_event.id;
    return query select 'stale_ignored'::text, null::text;
    return;
  end if;

  if v_subscription.provider_state_updated_at = v_facts.provider_updated_at then
    if v_subscription.billing_provider='lemonsqueezy'
       and v_subscription.billing_environment=v_event.environment
       and v_subscription.provider_customer_id is not distinct from v_facts.provider_customer_id
       and v_subscription.provider_subscription_id=v_facts.provider_subscription_id
       and v_subscription.plan_id=v_checkout.requested_plan_id
       and v_subscription.status='active'
       and v_subscription.current_period_starts_at=v_facts.provider_created_at
       and v_subscription.current_period_ends_at=v_facts.provider_renews_at
       and v_checkout.status='completed'
       and v_checkout.resulting_subscription_id=v_subscription.id
       and v_checkout.provider_order_id=v_facts.provider_order_id then
      update public.billing_webhook_events
      set processing_status='processed', processed_at=p_now,
          error_code=null, updated_at=p_now
      where id=v_event.id;
      return query select 'processed'::text, null::text;
      return;
    end if;
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_same_timestamp_conflict', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_same_timestamp_conflict'::text;
    return;
  end if;

  if v_checkout.status = 'completed' then
    if v_checkout.salon_id=v_subscription.salon_id
       and v_checkout.resulting_subscription_id=v_subscription.id
       and v_checkout.provider_order_id=v_facts.provider_order_id
       and v_subscription.provider_subscription_id=v_facts.provider_subscription_id
       and v_subscription.provider_customer_id is not distinct from v_facts.provider_customer_id
       and v_subscription.billing_provider='lemonsqueezy'
       and v_subscription.billing_environment=v_event.environment
       and v_subscription.plan_id=v_checkout.requested_plan_id
       and v_subscription.status='active'
       and v_subscription.current_period_starts_at=v_facts.provider_created_at
       and v_subscription.current_period_ends_at=v_facts.provider_renews_at
       and v_subscription.provider_state_updated_at=v_facts.provider_updated_at then
      update public.billing_webhook_events
      set processing_status='processed', processed_at=p_now,
          error_code=null, updated_at=p_now
      where id=v_event.id;
      return query select 'processed'::text, null::text;
      return;
    end if;
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_completed_checkout_conflict', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_completed_checkout_conflict'::text;
    return;
  elsif v_checkout.status <> 'open' then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_checkout_state_invalid', salon_id=v_checkout.salon_id, updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_checkout_state_invalid'::text;
    return;
  end if;

  -- C1: final target-capacity check in the branch that actually activates. The capacity lock
  -- is taken after the subscription lock; employee writers take only this lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rezervo:employee-capacity:' || v_checkout.salon_id::text, 0)
  );
  select pg_catalog.count(*) into v_active_employees
  from public.employees e where e.salon_id=v_checkout.salon_id and e.is_active=true;
  if v_plan.max_employees is not null and v_active_employees > v_plan.max_employees then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_checkout_capacity_exceeded', salon_id=v_checkout.salon_id,
        updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_checkout_capacity_exceeded'::text;
    return;
  end if;

  update public.subscriptions
  set plan_id=v_checkout.requested_plan_id,
      status='active', billing_provider='lemonsqueezy',
      billing_environment=v_event.environment,
      provider_customer_id=v_facts.provider_customer_id,
      provider_subscription_id=v_facts.provider_subscription_id,
      current_period_starts_at=v_facts.provider_created_at,
      current_period_ends_at=v_facts.provider_renews_at,
      cancel_at_period_end=false, cancelled_at=null,
      provider_state_updated_at=v_facts.provider_updated_at,
      provider_last_webhook_event_id=v_event.id,
      updated_at=p_now
  where id=v_subscription.id;

  update public.billing_checkout_sessions
  set status='completed', provider_order_id=v_facts.provider_order_id,
      resulting_subscription_id=v_subscription.id, completed_at=p_now,
      failed_at=null, error_code=null, updated_at=p_now
  where id=v_checkout.id;

  update public.billing_webhook_events
  set processing_status='processed', processed_at=p_now,
      error_code=null, salon_id=v_checkout.salon_id, updated_at=p_now
  where id=v_event.id;

  return query select 'processed'::text, null::text;
end;
$$;

comment on function public.process_billing_subscription_created_v2(uuid, timestamptz) is
  'Confirms an already-issued Lemon Squeezy checkout in the locked event environment. The activating branch re-checks the target employee limit under the capacity lock and parks the event as processor_checkout_capacity_exceeded (with salon correlation) instead of activating.';

-- ---------------------------------------------------------------------------
-- Owner/manager deactivation no longer requires full billing access.
-- ---------------------------------------------------------------------------

create or replace function public.set_employee_active_state(
  p_employee_id uuid, p_is_active boolean
)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_access record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  select e.* into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if not public.is_salon_owner_or_manager(v_employee.salon_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_employee.is_active = p_is_active then
    return v_employee;
  end if;

  -- Deactivation only reduces capacity use, so it stays available in read-only access.
  -- Activation still needs canonical full access and remains capacity-trigger protected.
  if p_is_active then
    select * into v_access
    from public.resolve_salon_access_v1(v_employee.salon_id, pg_catalog.now());
    if not coalesce(v_access.has_full_access, false) then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_ACCESS_REQUIRED';
    end if;
  end if;

  update public.employees e set
    is_active = p_is_active,
    is_bookable = case when p_is_active then e.is_bookable else false end,
    is_public = case when p_is_active then e.is_public else false end
  where e.id = p_employee_id
  returning e.* into v_employee;

  return v_employee;
end;
$$;

comment on function public.set_employee_active_state(uuid, boolean)
  is 'Owner/manager active-state change. Deactivation is allowed in read-only access; activation requires canonical full access and the capacity trigger.';

-- ---------------------------------------------------------------------------
-- Operator recovery: created events parked for capacity or an expired checkout.
-- ---------------------------------------------------------------------------

create or replace function private.evaluate_billing_event_reprocess_v1(
  p_environment text,
  p_event public.billing_webhook_events,
  p_now timestamptz
)
returns table(verdict text, error_code text, subscription_id uuid, review_token text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_facts public.billing_webhook_subscription_facts%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_checkout public.billing_checkout_sessions%rowtype;
  v_plan public.plans%rowtype;
  v_have_subscription boolean := false;
  v_active integer;
  v_checkouts text;
  v_verdict text;
  v_error text;
begin
  if p_event.provider is distinct from 'lemonsqueezy'
     or p_event.environment is distinct from p_environment
     or p_event.provider_object_type is distinct from 'subscriptions'
     or p_event.event_name not in ('subscription_created', 'subscription_updated') then
    v_verdict := 'unsupported_event';
    v_error := 'recovery_event_unsupported';
  elsif p_event.processing_status = 'processed' then
    v_verdict := 'already_processed';
  elsif p_event.processing_status <> 'manual_review' then
    v_verdict := 'not_manual_review';
    v_error := 'recovery_event_not_in_manual_review';
  elsif p_event.processing_claim_token is not null
     and p_event.processing_lease_until is not null
     and p_event.processing_lease_until > p_now then
    v_verdict := 'event_busy';
    v_error := 'recovery_event_leased';
  elsif not (
      (p_event.event_name = 'subscription_updated'
        and p_event.error_code in ('processor_updated_subscription_unknown', 'processor_retry_exhausted'))
      or (p_event.event_name = 'subscription_created'
        and p_event.error_code in ('processor_retry_exhausted',
          'processor_checkout_capacity_exceeded', 'processor_checkout_state_invalid'))
    ) then
    v_verdict := 'reason_not_allowed';
    v_error := 'recovery_reason_not_allowed';
  else
    select * into v_facts
    from public.billing_webhook_subscription_facts where webhook_event_id = p_event.id;
    if not found or v_facts.facts_schema_version <> 2
       or v_facts.provider_subscription_id is distinct from p_event.provider_object_id then
      v_verdict := 'precondition_unmet';
      v_error := 'recovery_event_facts_invalid';
    elsif p_event.event_name = 'subscription_updated' then
      select * into v_subscription
      from public.subscriptions
      where billing_provider = 'lemonsqueezy' and billing_environment = p_environment
        and provider_subscription_id = v_facts.provider_subscription_id;
      v_have_subscription := found;
      if not v_have_subscription then
        v_verdict := 'precondition_unmet';
        v_error := 'recovery_local_subscription_missing';
      else
        v_verdict := 'eligible';
      end if;
    elsif p_event.error_code = 'processor_retry_exhausted' then
      v_verdict := 'eligible';
    elsif v_facts.correlation_status <> 'ready' or v_facts.checkout_session_id is null then
      v_verdict := 'conflict';
      v_error := 'recovery_checkout_correlation_invalid';
    else
      select * into v_checkout
      from public.billing_checkout_sessions where id = v_facts.checkout_session_id;
      if not found
         or v_checkout.provider <> 'lemonsqueezy'
         or v_checkout.environment is distinct from p_environment
         or v_checkout.salon_id is distinct from v_facts.custom_salon_id
         or v_checkout.idempotency_key is distinct from v_facts.custom_idempotency_key then
        v_verdict := 'conflict';
        v_error := 'recovery_checkout_correlation_invalid';
      elsif (p_event.error_code = 'processor_checkout_capacity_exceeded' and v_checkout.status <> 'open')
         or (p_event.error_code = 'processor_checkout_state_invalid' and v_checkout.status <> 'expired') then
        v_verdict := 'conflict';
        v_error := 'recovery_checkout_state_unsupported';
      else
        select * into v_subscription from public.subscriptions where salon_id = v_checkout.salon_id;
        v_have_subscription := found;
        select * into v_plan from public.plans where id = v_checkout.requested_plan_id;
        select pg_catalog.count(*) into v_active
        from public.employees e where e.salon_id = v_checkout.salon_id and e.is_active;
        select private.billing_sha256_v1(coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', c.id, 'status', c.status, 'updated_at', private.billing_epoch_v1(c.updated_at))
            order by c.created_at, c.id), '[]'::jsonb))
          into v_checkouts
        from public.billing_checkout_sessions c
        where c.salon_id = v_checkout.salon_id and c.provider = 'lemonsqueezy'
          and c.environment = p_environment;

        if not v_have_subscription then
          v_verdict := 'conflict';
          v_error := 'recovery_subscription_missing';
        elsif v_subscription.billing_provider is not null
           or v_subscription.billing_environment is not null
           or v_subscription.provider_customer_id is not null
           or v_subscription.provider_subscription_id is not null then
          -- never overwrite another provider subscription
          v_verdict := 'conflict';
          v_error := 'recovery_subscription_already_linked';
        elsif exists (
          select 1 from public.billing_checkout_sessions c
          where c.salon_id = v_checkout.salon_id and c.provider = 'lemonsqueezy'
            and c.environment = p_environment and c.id <> v_checkout.id and c.status = 'completed'
        ) then
          v_verdict := 'conflict';
          v_error := 'recovery_other_checkout_completed';
        elsif exists (
          -- A later checkout reached the provider (creating/open/expired). Its URL expiring and
          -- no created event having arrived are not proof it was not paid.
          select 1 from public.billing_checkout_sessions c
          where c.salon_id = v_checkout.salon_id and c.provider = 'lemonsqueezy'
            and c.environment = p_environment and c.id <> v_checkout.id
            and c.status in ('creating', 'open', 'expired')
            and (c.created_at, c.id) > (v_checkout.created_at, v_checkout.id)
        ) then
          v_verdict := 'precondition_unmet';
          v_error := 'recovery_replacement_checkout_unresolved';
        elsif exists (
          select 1
          from public.billing_webhook_events e
          join public.billing_webhook_subscription_facts f on f.webhook_event_id = e.id
          where e.event_name = 'subscription_created' and e.id <> p_event.id
            and f.custom_salon_id = v_checkout.salon_id
            and e.processing_status in ('received', 'manual_review')
        ) then
          v_verdict := 'precondition_unmet';
          v_error := 'recovery_other_created_event_pending';
        elsif v_plan.id is null or v_plan.slug not in ('starter', 'pro') then
          v_verdict := 'conflict';
          v_error := 'recovery_plan_invalid';
        elsif v_plan.max_employees is not null and v_active > v_plan.max_employees then
          v_verdict := 'precondition_unmet';
          v_error := 'recovery_target_capacity_exceeded';
        elsif v_facts.provider_renews_at is null or v_facts.provider_renews_at <= p_now then
          v_verdict := 'precondition_unmet';
          v_error := 'recovery_provider_period_elapsed';
        else
          v_verdict := 'eligible';
        end if;
      end if;
    end if;
  end if;

  return query select v_verdict, v_error,
    case when v_have_subscription then v_subscription.id else null::uuid end,
    private.billing_sha256_v1(pg_catalog.jsonb_build_object(
      'event_id', p_event.id,
      'status', p_event.processing_status,
      'error_code', p_event.error_code,
      'attempt_count', p_event.processing_attempt_count,
      'last_outcome', p_event.last_processing_outcome,
      'event_updated_at', private.billing_epoch_v1(p_event.updated_at),
      'verdict', v_verdict,
      'local', case when v_have_subscription
        then private.billing_subscription_state_fingerprint_v1(v_subscription) else null end,
      'checkouts', v_checkouts,
      'active_employees', v_active));
end;
$$;

create or replace function public.apply_billing_event_reprocess_v1(
  p_environment text,
  p_webhook_event_id uuid,
  p_review_token text,
  p_ticket_ref text,
  p_reason text,
  p_operator_label text,
  p_now timestamptz default pg_catalog.now()
)
returns table(outcome text, error_code text, audit_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event public.billing_webhook_events%rowtype;
  v_facts public.billing_webhook_subscription_facts%rowtype;
  v_eval record;
  v_processor record;
  v_after public.billing_webhook_events%rowtype;
  v_activation boolean := false;
  v_prior jsonb;
  v_applied jsonb;
  v_outcome text;
  v_error text;
  v_audit uuid;
begin
  if p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_RECOVERY_NOW_REQUIRED';
  end if;
  perform private.validate_billing_recovery_input_v1(
    p_environment, p_ticket_ref, p_reason, p_operator_label);
  if p_review_token is null or p_review_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_REVIEW_TOKEN_REQUIRED';
  end if;
  if not public.billing_environment_matches_v1(p_environment) then
    return query select 'environment_mismatch'::text, 'recovery_environment_mismatch'::text, null::uuid;
    return;
  end if;

  select * into v_event from public.billing_webhook_events
  where id = p_webhook_event_id for update;
  if not found or v_event.environment is distinct from p_environment then
    return query select 'not_found'::text, 'recovery_event_not_found'::text, null::uuid;
    return;
  end if;

  -- Created activation recovery takes the created processor's locks up front, in its order,
  -- so the evaluation, the review-token check and the activation see one locked state.
  if v_event.event_name = 'subscription_created'
     and v_event.processing_status = 'manual_review'
     and v_event.error_code in ('processor_checkout_capacity_exceeded', 'processor_checkout_state_invalid') then
    select * into v_facts from public.billing_webhook_subscription_facts
    where webhook_event_id = v_event.id for update;
    if found and v_facts.custom_salon_id is not null then
      v_activation := true;
      perform 1 from public.billing_checkout_sessions c
      where c.salon_id = v_facts.custom_salon_id and c.provider = 'lemonsqueezy'
        and c.environment = p_environment
      order by c.created_at, c.id
      for update;
      perform 1 from public.plans p
      where p.id = (select c.requested_plan_id from public.billing_checkout_sessions c
                    where c.id = v_facts.checkout_session_id)
      for share;
      perform 1 from public.subscriptions s where s.salon_id = v_facts.custom_salon_id for update;
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('rezervo:employee-capacity:' || v_facts.custom_salon_id::text, 0));
    end if;
  end if;

  select * into v_eval from private.evaluate_billing_event_reprocess_v1(p_environment, v_event, p_now);
  v_prior := pg_catalog.jsonb_build_object(
    'event_name', v_event.event_name,
    'processing_status', v_event.processing_status,
    'error_code', v_event.error_code,
    'attempt_count', v_event.processing_attempt_count,
    'last_processing_outcome', v_event.last_processing_outcome);
  v_outcome := v_eval.verdict;
  v_error := v_eval.error_code;

  if v_eval.verdict = 'already_processed' then
    v_outcome := 'no_change';
  elsif v_eval.verdict = 'eligible' and v_eval.review_token is distinct from p_review_token then
    v_outcome := 'stale';
    v_error := 'recovery_review_token_stale';
  elsif v_eval.verdict = 'eligible' and v_activation then
    -- Everything below is one subtransaction: any non-success result rolls back the
    -- temporary expired -> open transition, the event reset and every processor write.
    begin
      update public.billing_checkout_sessions
      set status = 'open', updated_at = p_now
      where id = v_facts.checkout_session_id and status = 'expired';
      update public.billing_webhook_events
      set processing_status = 'received', error_code = null, processed_at = null,
          next_processing_attempt_at = p_now, last_processing_outcome = 'operator_reprocess',
          last_processing_attempt_at = p_now, processing_attempt_count = processing_attempt_count + 1,
          processing_lease_until = null, processing_claim_token = null, updated_at = p_now
      where id = v_event.id;
      select * into v_processor from public.process_billing_subscription_created_v2(v_event.id, p_now);
      select * into v_after from public.billing_webhook_events where id = v_event.id;
      v_applied := pg_catalog.jsonb_build_object(
        'processor_outcome', v_processor.outcome,
        'processing_status', v_after.processing_status,
        'error_code', v_after.error_code);
      if v_processor.outcome is distinct from 'processed' then
        raise exception using errcode = 'P0001', message = 'BILLING_RECOVERY_ACTIVATION_ROLLBACK';
      end if;
      v_outcome := 'reprocessed';
      v_error := null;
    exception when sqlstate 'P0001' then
      if sqlerrm is distinct from 'BILLING_RECOVERY_ACTIVATION_ROLLBACK' then
        raise;
      end if;
      v_outcome := 'activation_rejected';
      v_error := v_processor.error_code;
      v_applied := v_applied || pg_catalog.jsonb_build_object('rolled_back', true);
    end;
  elsif v_eval.verdict = 'eligible' then
    update public.billing_webhook_events
    set processing_status = 'received', error_code = null, processed_at = null,
        next_processing_attempt_at = p_now, last_processing_outcome = 'operator_reprocess',
        last_processing_attempt_at = p_now, processing_attempt_count = processing_attempt_count + 1,
        processing_lease_until = null, processing_claim_token = null, updated_at = p_now
    where id = v_event.id;

    if v_event.event_name = 'subscription_created' then
      select * into v_processor from public.process_billing_subscription_created_v2(v_event.id, p_now);
    else
      select * into v_processor from public.process_billing_subscription_updated_v2(v_event.id, p_now);
    end if;
    select * into v_after from public.billing_webhook_events where id = v_event.id;

    v_outcome := case v_processor.outcome
      when 'processed' then 'reprocessed'
      when 'already_applied' then 'reprocessed'
      when 'stale_ignored' then 'reprocessed'
      when 'dependency_pending' then 'dependency_pending'
      when 'manual_review' then 'manual_review'
      else 'unexpected_outcome'
    end;
    v_error := v_processor.error_code;
    v_applied := pg_catalog.jsonb_build_object(
      'processor_outcome', v_processor.outcome,
      'processing_status', v_after.processing_status,
      'error_code', v_after.error_code);
  end if;

  v_audit := private.record_billing_recovery_attempt_v1(
    'event_reprocess', p_environment, v_event.id, v_eval.subscription_id,
    v_event.provider_object_id, 'existing_webhook_event', null, null, v_prior, v_applied,
    p_ticket_ref, p_reason, p_operator_label, v_outcome, v_error, p_review_token);

  return query select v_outcome, v_error, v_audit;
end;
$$;

comment on function public.apply_billing_event_reprocess_v1(text,uuid,text,text,text,text,timestamptz) is
  'Explicit, audited re-processing of one allowlisted manual_review webhook event through the existing v2 processors. Created events parked for capacity or an expired checkout are activated only inside a subtransaction that is fully rolled back unless the processor reports processed.';

commit;

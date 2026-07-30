begin;

-- Shared environment-aware processor foundation. Both test and live derive their
-- authority from the locked webhook event; callers cannot choose an environment.
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
        error_code='processor_checkout_state_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_checkout_state_invalid'::text;
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

create or replace function public.process_billing_subscription_updated_v2(
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
  v_subscription public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_mapping_count integer := 0;
  v_expected_status public.subscription_status;
  v_expected_period_end timestamptz;
  v_expected_cancel_at_period_end boolean;
  v_expected_cancelled_at timestamptz;
  v_error_code text;
begin
  if p_now is null then
    raise exception using errcode='22004', message='BILLING_PROCESSOR_NOW_REQUIRED';
  end if;

  select * into v_event
  from public.billing_webhook_events
  where id=p_webhook_event_id
  for update;

  if not found then
    raise exception using errcode='P0001', message='BILLING_WEBHOOK_EVENT_NOT_FOUND';
  end if;
  if v_event.processing_status='processed' then
    return query select 'already_processed'::text, null::text;
    return;
  end if;
  if v_event.processing_status='manual_review' then
    return query select 'manual_review'::text, v_event.error_code;
    return;
  end if;
  if v_event.provider<>'lemonsqueezy'
     or v_event.environment not in ('test', 'live')
     or v_event.event_name<>'subscription_updated'
     or v_event.provider_object_type<>'subscriptions'
     or v_event.processing_status<>'received' then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_updated_event_contract_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text,
      'processor_updated_event_contract_invalid'::text;
    return;
  end if;

  select * into v_facts
  from public.billing_webhook_subscription_facts
  where webhook_event_id=v_event.id
  for update;

  if not found or v_facts.facts_schema_version<>2
     or (v_event.environment = 'test' and v_facts.test_mode is distinct from true)
       or (v_event.environment = 'live' and v_facts.test_mode is distinct from false) then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_updated_facts_contract_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text,
      'processor_updated_facts_contract_invalid'::text;
    return;
  end if;
  if v_event.provider_object_id is distinct from v_facts.provider_subscription_id then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_updated_event_facts_identity_conflict', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text,
      'processor_updated_event_facts_identity_conflict'::text;
    return;
  end if;

  select * into v_subscription
  from public.subscriptions
  where billing_provider='lemonsqueezy'
    and billing_environment=v_event.environment
    and provider_subscription_id=v_facts.provider_subscription_id
  for update;

  if not found then
    if exists (
      select 1
      from public.billing_webhook_events created_event
      join public.billing_webhook_subscription_facts created_facts
        on created_facts.webhook_event_id=created_event.id
      where created_event.provider='lemonsqueezy'
        and created_event.environment=v_event.environment
        and created_event.event_name='subscription_created'
        and created_event.provider_object_type='subscriptions'
        and created_event.processing_status='received'
        and created_facts.provider_subscription_id=v_facts.provider_subscription_id
    ) then
      return query select 'dependency_pending'::text,
        'processor_updated_created_dependency_pending'::text;
      return;
    end if;
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_updated_subscription_unknown', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text,
      'processor_updated_subscription_unknown'::text;
    return;
  end if;

  select * into v_plan
  from public.plans
  where id=v_subscription.plan_id
  for share;

  perform 1
  from public.billing_provider_prices
  where provider='lemonsqueezy'
    and environment=v_event.environment
    and plan_id=v_subscription.plan_id
    and billing_interval='monthly'
    and provider_store_id=v_facts.provider_store_id
    and provider_product_id=v_facts.provider_product_id
    and provider_variant_id=v_facts.provider_variant_id
  for share;
  get diagnostics v_mapping_count = row_count;

  if v_subscription.billing_provider<>'lemonsqueezy'
     or v_subscription.billing_environment is distinct from v_event.environment
     or v_subscription.provider_subscription_id is distinct from v_facts.provider_subscription_id
     or v_facts.provider_customer_id is null
     or not (v_facts.provider_customer_id ~ '[^[:space:]]')
     or v_subscription.provider_customer_id is distinct from v_facts.provider_customer_id then
    v_error_code := 'processor_updated_provider_ownership_conflict';
  elsif v_plan.id is null or v_plan.slug not in ('starter','pro') then
    v_error_code := 'processor_updated_plan_invalid';
  elsif v_facts.provider_store_id is null
     or not (v_facts.provider_store_id ~ '[^[:space:]]')
     or v_facts.provider_variant_id is null
     or not (v_facts.provider_variant_id ~ '[^[:space:]]')
     or v_facts.provider_product_id is null
     or not (v_facts.provider_product_id ~ '[^[:space:]]') then
    v_error_code := 'processor_updated_provider_mapping_invalid';
  elsif v_mapping_count<>1 then
    if exists (
      select 1
      from public.billing_provider_prices other_mapping
      join public.plans other_plan on other_plan.id=other_mapping.plan_id
      where other_mapping.provider='lemonsqueezy'
        and other_mapping.environment=v_event.environment
        and other_mapping.billing_interval='monthly'
        and other_plan.slug in ('starter','pro')
        and other_mapping.plan_id<>v_subscription.plan_id
        and other_mapping.provider_variant_id=v_facts.provider_variant_id
        and other_mapping.provider_product_id is not distinct from v_facts.provider_product_id
    ) then
      v_error_code := 'processor_updated_plan_change_unsupported';
    else
      v_error_code := 'processor_updated_provider_mapping_invalid';
    end if;
  end if;

  if v_error_code is not null then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code=v_error_code, salon_id=v_subscription.salon_id, updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, v_error_code;
    return;
  end if;

  if v_facts.provider_created_at is null
     or v_facts.provider_updated_at is null
     or v_facts.provider_updated_at<v_facts.provider_created_at then
    v_error_code := 'processor_updated_provider_state_unsupported';
  end if;

  if v_error_code is not null then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code=v_error_code, salon_id=v_subscription.salon_id, updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, v_error_code;
    return;
  end if;

  if v_subscription.provider_state_updated_at is not null
     and v_facts.provider_updated_at<v_subscription.provider_state_updated_at then
    update public.billing_webhook_events
    set processing_status='processed', processed_at=p_now, error_code=null,
        salon_id=v_subscription.salon_id, updated_at=p_now
    where id=v_event.id;
    return query select 'stale_ignored'::text, null::text;
    return;
  end if;

  if v_facts.provider_pause_mode is not null
     or v_facts.provider_pause_resumes_at is not null then
    v_error_code := 'processor_updated_pause_unsupported';
  elsif v_facts.provider_status='on_trial'
     or v_facts.provider_trial_ends_at is not null then
    v_error_code := 'processor_updated_provider_trial_unsupported';
  elsif v_facts.provider_status='active' then
    if v_subscription.status='expired' then
      v_error_code := 'processor_updated_expired_reactivation_unsupported';
    elsif v_subscription.status not in ('active','cancelled','past_due')
       or v_facts.provider_cancelled is distinct from false
       or v_facts.provider_ends_at is not null
       or v_facts.provider_renews_at is null
       or v_facts.provider_renews_at<=p_now
       or v_subscription.current_period_starts_at is null
       or v_facts.provider_renews_at<=v_subscription.current_period_starts_at then
      v_error_code := 'processor_updated_provider_state_unsupported';
    else
      v_expected_status := 'active';
      v_expected_period_end := v_facts.provider_renews_at;
      v_expected_cancel_at_period_end := false;
      v_expected_cancelled_at := null;
    end if;
  elsif v_facts.provider_status='cancelled' then
    if v_facts.provider_cancelled is distinct from true
       or v_facts.provider_ends_at is null
       or v_facts.provider_ends_at<=p_now
       or v_facts.provider_ends_at<=v_facts.provider_updated_at then
      v_error_code := 'processor_updated_provider_state_unsupported';
    else
      v_expected_status := 'cancelled';
      v_expected_period_end := v_facts.provider_ends_at;
      v_expected_cancel_at_period_end := true;
      v_expected_cancelled_at := coalesce(
        v_subscription.cancelled_at, v_facts.provider_updated_at
      );
    end if;
  elsif v_facts.provider_status in ('past_due','unpaid') then
    if v_facts.provider_cancelled is distinct from false
       or v_facts.provider_ends_at is not null then
      v_error_code := 'processor_updated_provider_state_unsupported';
    else
      v_expected_status := 'past_due';
      v_expected_period_end := v_subscription.current_period_ends_at;
      v_expected_cancel_at_period_end := false;
      v_expected_cancelled_at := null;
    end if;
  elsif v_facts.provider_status='expired' then
    if v_facts.provider_ends_at is null
       or v_facts.provider_ends_at>p_now
       or v_facts.provider_ends_at>v_facts.provider_updated_at then
      v_error_code := 'processor_updated_provider_state_unsupported';
    else
      v_expected_status := 'expired';
      v_expected_period_end := v_facts.provider_ends_at;
      v_expected_cancel_at_period_end := false;
      v_expected_cancelled_at := v_subscription.cancelled_at;
    end if;
  else
    v_error_code := 'processor_updated_provider_state_unsupported';
  end if;

  if v_error_code is not null then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code=v_error_code, salon_id=v_subscription.salon_id, updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, v_error_code;
    return;
  end if;

  if v_subscription.provider_state_updated_at=v_facts.provider_updated_at then
    if v_subscription.status=v_expected_status
       and v_subscription.current_period_ends_at is not distinct from v_expected_period_end
       and v_subscription.cancel_at_period_end is not distinct from v_expected_cancel_at_period_end
       and v_subscription.cancelled_at is not distinct from v_expected_cancelled_at then
      update public.billing_webhook_events
      set processing_status='processed', processed_at=p_now, error_code=null,
          salon_id=v_subscription.salon_id, updated_at=p_now
      where id=v_event.id;
      return query select 'already_applied'::text, null::text;
      return;
    end if;
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_updated_same_timestamp_conflict',
        salon_id=v_subscription.salon_id, updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text,
      'processor_updated_same_timestamp_conflict'::text;
    return;
  end if;

  update public.subscriptions
  set status=v_expected_status,
      current_period_ends_at=v_expected_period_end,
      cancel_at_period_end=v_expected_cancel_at_period_end,
      cancelled_at=v_expected_cancelled_at,
      provider_state_updated_at=v_facts.provider_updated_at,
      provider_last_webhook_event_id=v_event.id,
      updated_at=p_now
  where id=v_subscription.id;

  update public.billing_webhook_events
  set processing_status='processed', processed_at=p_now, error_code=null,
      salon_id=v_subscription.salon_id, updated_at=p_now
  where id=v_event.id;

  return query select 'processed'::text, null::text;
end;
$$;

revoke all on function public.process_billing_subscription_created_v2(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.process_billing_subscription_updated_v2(uuid, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.process_billing_subscription_created_v2(uuid, timestamptz)
  to service_role;
grant execute on function public.process_billing_subscription_updated_v2(uuid, timestamptz)
  to service_role;

comment on function public.process_billing_subscription_created_v2(uuid, timestamptz) is
  'Confirms an already-issued Lemon Squeezy checkout in the locked event environment. Checkout creation owns current catalogue availability; exact historical Store/Product/Variant identity remains required even if the plan or mapping was later deactivated.';
comment on function public.process_billing_subscription_updated_v2(uuid, timestamptz) is
  'Processes a verified Lemon Squeezy subscription_updated event in the environment owned by the locked event row.';

commit;

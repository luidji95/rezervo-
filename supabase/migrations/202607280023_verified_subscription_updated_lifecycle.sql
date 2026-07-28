begin;

create or replace function public.process_billing_subscription_updated_v1(
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
  v_mapping public.billing_provider_prices%rowtype;
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
     or v_event.environment<>'test'
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
     or v_facts.test_mode is distinct from true then
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
    and billing_environment='test'
    and provider_subscription_id=v_facts.provider_subscription_id
  for update;

  if not found then
    if exists (
      select 1
      from public.billing_webhook_events created_event
      join public.billing_webhook_subscription_facts created_facts
        on created_facts.webhook_event_id=created_event.id
      where created_event.provider='lemonsqueezy'
        and created_event.environment='test'
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

  select * into v_mapping
  from public.billing_provider_prices
  where provider='lemonsqueezy' and environment='test'
    and plan_id=v_subscription.plan_id
    and billing_interval='monthly' and is_active
  for share;

  if v_subscription.billing_provider<>'lemonsqueezy'
     or v_subscription.billing_environment<>'test'
     or v_subscription.provider_subscription_id is distinct from v_facts.provider_subscription_id
     or v_facts.provider_customer_id is null
     or not (v_facts.provider_customer_id ~ '[^[:space:]]')
     or v_subscription.provider_customer_id is distinct from v_facts.provider_customer_id then
    v_error_code := 'processor_updated_provider_ownership_conflict';
  elsif v_plan.id is null or not v_plan.is_active
     or v_plan.slug not in ('starter','pro') then
    v_error_code := 'processor_updated_plan_invalid';
  elsif v_mapping.id is null
     or v_mapping.provider_store_id is null
     or v_facts.provider_store_id is null
     or v_mapping.provider_store_id is distinct from v_facts.provider_store_id then
    v_error_code := 'processor_updated_provider_mapping_invalid';
  elsif v_mapping.provider_variant_id is distinct from v_facts.provider_variant_id
     or (v_mapping.provider_product_id is not null
         and v_mapping.provider_product_id is distinct from v_facts.provider_product_id) then
    if exists (
      select 1
      from public.billing_provider_prices other_mapping
      join public.plans other_plan on other_plan.id=other_mapping.plan_id
      where other_mapping.provider='lemonsqueezy'
        and other_mapping.environment='test'
        and other_mapping.billing_interval='monthly'
        and other_mapping.is_active and other_plan.is_active
        and other_plan.slug in ('starter','pro')
        and other_mapping.plan_id<>v_subscription.plan_id
        and other_mapping.provider_variant_id=v_facts.provider_variant_id
        and (other_mapping.provider_product_id is null
             or other_mapping.provider_product_id is not distinct from v_facts.provider_product_id)
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
       or v_facts.provider_renews_at<=p_now then
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

revoke all on function public.process_billing_subscription_updated_v1(uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_billing_subscription_updated_v1(uuid,timestamptz)
  to service_role;

comment on function public.process_billing_subscription_updated_v1(uuid,timestamptz) is
  'Atomically applies verified Lemon Squeezy test subscription_updated state to an existing linked subscription without checkout or entitlement mutation.';

commit;

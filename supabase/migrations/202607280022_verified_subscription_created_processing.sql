begin;

alter table public.billing_webhook_subscription_facts
  alter column facts_schema_version set default 2,
  add column provider_store_id text,
  add column provider_renews_at timestamptz,
  add column provider_ends_at timestamptz,
  add column provider_cancelled boolean,
  add column provider_trial_ends_at timestamptz,
  add column provider_pause_mode text,
  add column provider_pause_resumes_at timestamptz;

alter table public.billing_webhook_subscription_facts
  drop constraint billing_webhook_subscription_facts_version_check,
  add constraint billing_webhook_subscription_facts_version_check
    check (facts_schema_version in (1, 2)),
  add constraint billing_webhook_subscription_facts_store_id_check
    check (provider_store_id is null or provider_store_id ~ '[^[:space:]]'),
  add constraint billing_webhook_subscription_facts_pause_mode_check
    check (provider_pause_mode is null or provider_pause_mode in ('free', 'void')),
  add constraint billing_webhook_subscription_facts_pause_resume_check
    check (provider_pause_mode is not null or provider_pause_resumes_at is null);

alter table public.subscriptions
  add column provider_state_updated_at timestamptz,
  add column provider_last_webhook_event_id uuid
    references public.billing_webhook_events(id) on delete set null;

create index subscriptions_provider_last_webhook_event_idx
  on public.subscriptions(provider_last_webhook_event_id);

alter table public.billing_provider_prices
  add column provider_store_id text,
  add constraint billing_provider_prices_store_id_check
    check (provider_store_id is null or provider_store_id ~ '[^[:space:]]');

update public.billing_provider_prices bpp
set provider_store_id = '440512'
from public.plans p
where p.id = bpp.plan_id
  and bpp.provider = 'lemonsqueezy'
  and bpp.environment = 'test'
  and bpp.is_active = true
  and p.is_active = true
  and p.slug in ('starter', 'pro');

alter table public.billing_webhook_events
  drop constraint billing_webhook_events_status_check,
  add constraint billing_webhook_events_status_check
    check (processing_status in (
      'received', 'ignored', 'processed', 'failed', 'manual_review'
    ));

create or replace function public.ingest_billing_webhook_event_v1(
  p_provider text, p_environment text, p_event_name text,
  p_provider_object_type text, p_provider_object_id text,
  p_payload_hash text, p_semantic_fingerprint text,
  p_processing_status text, p_processed_at timestamptz,
  p_has_subscription_facts boolean, p_checkout_session_id uuid,
  p_custom_salon_id uuid, p_custom_plan_code text,
  p_custom_idempotency_key uuid, p_provider_subscription_id text,
  p_provider_order_id text, p_provider_customer_id text,
  p_provider_product_id text, p_provider_variant_id text,
  p_provider_status text, p_provider_created_at timestamptz,
  p_provider_updated_at timestamptz, p_test_mode boolean,
  p_correlation_status text, p_correlation_error_code text
)
returns table(event_id uuid, outcome text, stored_status text)
language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid; v_existing_status text;
begin
  if p_processing_status not in ('received', 'ignored')
     or (p_processing_status='received' and p_has_subscription_facts is distinct from true)
     or (p_processing_status='ignored' and p_has_subscription_facts is distinct from false) then
    raise exception using errcode='23514', message='BILLING_WEBHOOK_EVENT_FACTS_CONTRACT_INVALID';
  end if;
  if p_has_subscription_facts and (
    p_provider_subscription_id is null
    or not (p_provider_subscription_id ~ '[^[:space:]]')
    or p_test_mode is null or p_correlation_status is null
  ) then
    raise exception using errcode='23514', message='BILLING_WEBHOOK_SUBSCRIPTION_FACTS_REQUIRED';
  end if;
  if (p_environment='test' and p_test_mode is distinct from true)
     or (p_environment='live' and p_test_mode is distinct from false) then
    raise exception using errcode='23514', message='BILLING_WEBHOOK_ENVIRONMENT_MISMATCH';
  end if;

  insert into public.billing_webhook_events(
    provider,environment,event_name,provider_object_type,provider_object_id,
    payload_hash,semantic_fingerprint,processing_status,processed_at
  ) values (
    p_provider,p_environment,p_event_name,p_provider_object_type,p_provider_object_id,
    p_payload_hash,p_semantic_fingerprint,p_processing_status,p_processed_at
  ) on conflict do nothing returning id into v_event_id;

  if v_event_id is null then
    select e.id,e.processing_status into v_event_id,v_existing_status
    from public.billing_webhook_events e
    where e.provider=p_provider and e.environment=p_environment
      and (e.payload_hash=p_payload_hash or e.semantic_fingerprint=p_semantic_fingerprint)
    order by e.received_at asc limit 1;
    if v_event_id is null then
      raise exception using errcode='P0001', message='BILLING_WEBHOOK_DUPLICATE_LOOKUP_FAILED';
    end if;
    return query select v_event_id,'duplicate'::text,v_existing_status;
    return;
  end if;

  if p_has_subscription_facts then
    insert into public.billing_webhook_subscription_facts(
      webhook_event_id,facts_schema_version,checkout_session_id,custom_salon_id,
      custom_plan_code,custom_idempotency_key,provider_subscription_id,
      provider_order_id,provider_customer_id,provider_product_id,
      provider_variant_id,provider_status,provider_created_at,
      provider_updated_at,test_mode,correlation_status,correlation_error_code
    ) values (
      v_event_id,1,p_checkout_session_id,p_custom_salon_id,p_custom_plan_code,
      p_custom_idempotency_key,p_provider_subscription_id,p_provider_order_id,
      p_provider_customer_id,p_provider_product_id,p_provider_variant_id,
      p_provider_status,p_provider_created_at,p_provider_updated_at,p_test_mode,
      p_correlation_status,p_correlation_error_code
    );
  end if;
  return query select v_event_id,'inserted'::text,p_processing_status;
end;
$$;

revoke all on function public.ingest_billing_webhook_event_v1(
  text,text,text,text,text,text,text,text,timestamptz,boolean,
  uuid,uuid,text,uuid,text,text,text,text,text,text,
  timestamptz,timestamptz,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.ingest_billing_webhook_event_v1(
  text,text,text,text,text,text,text,text,timestamptz,boolean,
  uuid,uuid,text,uuid,text,text,text,text,text,text,
  timestamptz,timestamptz,boolean,text,text
) to service_role;

create or replace function public.ingest_billing_webhook_event_v2(
  p_provider text,
  p_environment text,
  p_event_name text,
  p_provider_object_type text,
  p_provider_object_id text,
  p_payload_hash text,
  p_semantic_fingerprint text,
  p_processing_status text,
  p_processed_at timestamptz,
  p_has_subscription_facts boolean,
  p_checkout_session_id uuid,
  p_custom_salon_id uuid,
  p_custom_plan_code text,
  p_custom_idempotency_key uuid,
  p_provider_subscription_id text,
  p_provider_order_id text,
  p_provider_customer_id text,
  p_provider_product_id text,
  p_provider_variant_id text,
  p_provider_status text,
  p_provider_created_at timestamptz,
  p_provider_updated_at timestamptz,
  p_test_mode boolean,
  p_correlation_status text,
  p_correlation_error_code text,
  p_provider_store_id text,
  p_provider_renews_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_cancelled boolean,
  p_provider_trial_ends_at timestamptz,
  p_provider_pause_mode text,
  p_provider_pause_resumes_at timestamptz
)
returns table(event_id uuid, outcome text, stored_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_existing_status text;
begin
  if p_processing_status not in ('received', 'ignored')
     or (p_processing_status = 'received' and p_has_subscription_facts is distinct from true)
     or (p_processing_status = 'ignored' and p_has_subscription_facts is distinct from false) then
    raise exception using errcode = '23514', message = 'BILLING_WEBHOOK_EVENT_FACTS_CONTRACT_INVALID';
  end if;

  if p_has_subscription_facts
     and (
       p_provider_subscription_id is null
       or not (p_provider_subscription_id ~ '[^[:space:]]')
       or p_test_mode is null
       or p_correlation_status is null
     ) then
    raise exception using errcode = '23514', message = 'BILLING_WEBHOOK_SUBSCRIPTION_FACTS_REQUIRED';
  end if;

  if (p_environment = 'test' and p_test_mode is distinct from true)
     or (p_environment = 'live' and p_test_mode is distinct from false) then
    raise exception using errcode = '23514', message = 'BILLING_WEBHOOK_ENVIRONMENT_MISMATCH';
  end if;

  insert into public.billing_webhook_events(
    provider, environment, event_name, provider_object_type,
    provider_object_id, payload_hash, semantic_fingerprint,
    processing_status, processed_at
  ) values (
    p_provider, p_environment, p_event_name, p_provider_object_type,
    p_provider_object_id, p_payload_hash, p_semantic_fingerprint,
    p_processing_status, p_processed_at
  )
  on conflict do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id, e.processing_status
      into v_event_id, v_existing_status
    from public.billing_webhook_events e
    where e.provider = p_provider
      and e.environment = p_environment
      and (
        e.payload_hash = p_payload_hash
        or e.semantic_fingerprint = p_semantic_fingerprint
      )
    order by e.received_at asc
    limit 1;

    if v_event_id is null then
      raise exception using errcode = 'P0001', message = 'BILLING_WEBHOOK_DUPLICATE_LOOKUP_FAILED';
    end if;
    return query select v_event_id, 'duplicate'::text, v_existing_status;
    return;
  end if;

  if p_has_subscription_facts then
    insert into public.billing_webhook_subscription_facts(
      webhook_event_id, facts_schema_version, checkout_session_id,
      custom_salon_id, custom_plan_code, custom_idempotency_key,
      provider_subscription_id, provider_order_id, provider_customer_id,
      provider_product_id, provider_variant_id, provider_status,
      provider_created_at, provider_updated_at, test_mode,
      correlation_status, correlation_error_code, provider_store_id,
      provider_renews_at, provider_ends_at, provider_cancelled,
      provider_trial_ends_at, provider_pause_mode, provider_pause_resumes_at
    ) values (
      v_event_id, 2, p_checkout_session_id,
      p_custom_salon_id, p_custom_plan_code, p_custom_idempotency_key,
      p_provider_subscription_id, p_provider_order_id, p_provider_customer_id,
      p_provider_product_id, p_provider_variant_id, p_provider_status,
      p_provider_created_at, p_provider_updated_at, p_test_mode,
      p_correlation_status, p_correlation_error_code, p_provider_store_id,
      p_provider_renews_at, p_provider_ends_at, p_provider_cancelled,
      p_provider_trial_ends_at, p_provider_pause_mode, p_provider_pause_resumes_at
    );
  end if;

  return query select v_event_id, 'inserted'::text, p_processing_status;
end;
$$;

revoke all on function public.ingest_billing_webhook_event_v2(
  text,text,text,text,text,text,text,text,timestamptz,boolean,
  uuid,uuid,text,uuid,text,text,text,text,text,text,
  timestamptz,timestamptz,boolean,text,text,text,timestamptz,
  timestamptz,boolean,timestamptz,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.ingest_billing_webhook_event_v2(
  text,text,text,text,text,text,text,text,timestamptz,boolean,
  uuid,uuid,text,uuid,text,text,text,text,text,text,
  timestamptz,timestamptz,boolean,text,text,text,timestamptz,
  timestamptz,boolean,timestamptz,text,timestamptz
) to service_role;

create or replace function public.process_billing_subscription_created_v1(
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
  v_mapping public.billing_provider_prices%rowtype;
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
     or v_event.environment <> 'test'
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
     or v_facts.test_mode is distinct from true then
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
     or v_facts.provider_order_id is null
     or v_facts.provider_customer_id is null
     or v_facts.provider_product_id is null
     or v_facts.provider_variant_id is null then
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
     or v_checkout.environment <> 'test'
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

  if not found or not v_plan.is_active or v_plan.slug not in ('starter','pro')
     or v_plan.slug is distinct from v_facts.custom_plan_code then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_plan_correlation_invalid', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_plan_correlation_invalid'::text;
    return;
  end if;

  select * into v_mapping
  from public.billing_provider_prices
  where provider='lemonsqueezy' and environment='test'
    and plan_id=v_checkout.requested_plan_id
    and billing_interval='monthly' and is_active
    and provider_variant_id=v_facts.provider_variant_id
  for share;

  if not found
     or v_mapping.provider_store_id is null
     or v_mapping.provider_store_id is distinct from v_facts.provider_store_id
     or (v_mapping.provider_product_id is not null
         and v_mapping.provider_product_id is distinct from v_facts.provider_product_id) then
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
      and s.billing_environment='test'
      and s.provider_subscription_id=v_facts.provider_subscription_id
      and s.id<>v_subscription.id
  ) or exists(
    select 1 from public.billing_checkout_sessions c
    where c.provider='lemonsqueezy' and c.environment='test'
      and c.provider_order_id=v_facts.provider_order_id
      and c.id<>v_checkout.id
  ) into v_conflict;

  if v_conflict
     or (v_subscription.billing_provider is not null
         and v_subscription.billing_provider<>'lemonsqueezy')
     or (v_subscription.billing_environment is not null
         and v_subscription.billing_environment<>'test')
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
       and v_subscription.billing_environment='test'
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
       and v_subscription.billing_environment='test'
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
      billing_environment='test',
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

revoke all on function public.process_billing_subscription_created_v1(uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_billing_subscription_created_v1(uuid,timestamptz)
  to service_role;

comment on function public.ingest_billing_webhook_event_v2(
  text,text,text,text,text,text,text,text,timestamptz,boolean,
  uuid,uuid,text,uuid,text,text,text,text,text,text,
  timestamptz,timestamptz,boolean,text,text,text,timestamptz,
  timestamptz,boolean,timestamptz,text,timestamptz
) is 'Atomically stores webhook events and version 2 PII-free subscription facts; v1 remains available during rollout.';
comment on function public.process_billing_subscription_created_v1(uuid,timestamptz) is
  'Atomically verifies and applies sandbox subscription_created facts to one existing subscription and checkout ledger.';

commit;

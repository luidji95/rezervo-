begin;

create table public.billing_webhook_subscription_facts (
  webhook_event_id uuid primary key
    references public.billing_webhook_events(id) on delete cascade,
  facts_schema_version integer not null default 1,
  checkout_session_id uuid,
  custom_salon_id uuid,
  custom_plan_code text,
  custom_idempotency_key uuid,
  provider_subscription_id text not null,
  provider_order_id text,
  provider_customer_id text,
  provider_product_id text,
  provider_variant_id text,
  provider_status text,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  test_mode boolean not null,
  correlation_status text not null,
  correlation_error_code text,
  created_at timestamptz not null default now(),
  constraint billing_webhook_subscription_facts_version_check
    check (facts_schema_version = 1),
  constraint billing_webhook_subscription_facts_plan_check
    check (custom_plan_code is null or custom_plan_code in ('starter', 'pro')),
  constraint billing_webhook_subscription_facts_subscription_id_check
    check (provider_subscription_id ~ '[^[:space:]]'),
  constraint billing_webhook_subscription_facts_order_id_check
    check (provider_order_id is null or provider_order_id ~ '[^[:space:]]'),
  constraint billing_webhook_subscription_facts_customer_id_check
    check (provider_customer_id is null or provider_customer_id ~ '[^[:space:]]'),
  constraint billing_webhook_subscription_facts_product_id_check
    check (provider_product_id is null or provider_product_id ~ '[^[:space:]]'),
  constraint billing_webhook_subscription_facts_variant_id_check
    check (provider_variant_id is null or provider_variant_id ~ '[^[:space:]]'),
  constraint billing_webhook_subscription_facts_status_value_check
    check (provider_status is null or provider_status ~ '[^[:space:]]'),
  constraint billing_webhook_subscription_facts_correlation_status_check
    check (correlation_status in (
      'ready', 'legacy_missing_checkout_session', 'invalid_custom_data'
    )),
  constraint billing_webhook_subscription_facts_error_code_check
    check (
      correlation_error_code is null
      or correlation_error_code ~ '^[a-z0-9_]+$'
    ),
  constraint billing_webhook_subscription_facts_correlation_contract_check
    check (
      (
        correlation_status = 'ready'
        and checkout_session_id is not null
        and custom_salon_id is not null
        and custom_plan_code is not null
        and custom_idempotency_key is not null
        and correlation_error_code is null
      )
      or (
        correlation_status = 'legacy_missing_checkout_session'
        and checkout_session_id is null
        and custom_salon_id is not null
        and custom_plan_code is not null
        and custom_idempotency_key is not null
        and correlation_error_code is null
      )
      or (
        correlation_status = 'invalid_custom_data'
        and correlation_error_code is not null
        and correlation_error_code ~ '^[a-z0-9_]+$'
      )
    )
);

create index billing_webhook_subscription_facts_checkout_idx
  on public.billing_webhook_subscription_facts(checkout_session_id)
  where checkout_session_id is not null;
create index billing_webhook_subscription_facts_subscription_idx
  on public.billing_webhook_subscription_facts(provider_subscription_id);
create index billing_webhook_subscription_facts_order_idx
  on public.billing_webhook_subscription_facts(provider_order_id)
  where provider_order_id is not null;
create index billing_webhook_subscription_facts_subscription_updated_idx
  on public.billing_webhook_subscription_facts(
    provider_subscription_id,
    provider_updated_at desc
  );

alter table public.billing_webhook_subscription_facts enable row level security;
revoke all on table public.billing_webhook_subscription_facts
  from public, anon, authenticated, service_role;
grant select on table public.billing_webhook_subscription_facts to service_role;

create or replace function public.ingest_billing_webhook_event_v1(
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
  p_correlation_error_code text
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
      webhook_event_id, checkout_session_id, custom_salon_id,
      custom_plan_code, custom_idempotency_key, provider_subscription_id,
      provider_order_id, provider_customer_id, provider_product_id,
      provider_variant_id, provider_status, provider_created_at,
      provider_updated_at, test_mode, correlation_status,
      correlation_error_code
    ) values (
      v_event_id, p_checkout_session_id, p_custom_salon_id,
      p_custom_plan_code, p_custom_idempotency_key, p_provider_subscription_id,
      p_provider_order_id, p_provider_customer_id, p_provider_product_id,
      p_provider_variant_id, p_provider_status, p_provider_created_at,
      p_provider_updated_at, p_test_mode, p_correlation_status,
      p_correlation_error_code
    );
  end if;

  return query select v_event_id, 'inserted'::text, p_processing_status;
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

comment on table public.billing_webhook_subscription_facts is
  'Immutable, server-only, normalized subscription webhook facts. Raw payloads, signatures, URLs and customer PII are not retained.';
comment on function public.ingest_billing_webhook_event_v1(
  text,text,text,text,text,text,text,text,timestamptz,boolean,
  uuid,uuid,text,uuid,text,text,text,text,text,text,
  timestamptz,timestamptz,boolean,text,text
) is
  'Atomically inserts one webhook event and, for supported subscription events, exactly one immutable normalized facts row.';

commit;

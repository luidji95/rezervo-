begin;

create table public.billing_webhook_subscription_invoice_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  webhook_event_id uuid not null references public.billing_webhook_events(id) on delete restrict,
  provider text not null,
  environment text not null,
  provider_invoice_id text not null,
  provider_subscription_id text not null,
  provider_customer_id text not null,
  provider_store_id text not null,
  billing_reason text not null,
  invoice_status text not null,
  provider_invoice_created_at timestamptz not null,
  provider_invoice_updated_at timestamptz not null,
  evidence_status text not null default 'recorded',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint billing_webhook_subscription_invoice_facts_event_unique unique (webhook_event_id),
  constraint billing_webhook_subscription_invoice_facts_invoice_unique
    unique (provider, environment, provider_invoice_id),
  constraint billing_webhook_subscription_invoice_facts_provider_check
    check (provider = 'lemonsqueezy'),
  constraint billing_webhook_subscription_invoice_facts_environment_check
    check (environment in ('test', 'live')),
  constraint billing_webhook_subscription_invoice_facts_invoice_id_check
    check (provider_invoice_id ~ '^[1-9][0-9]*$'),
  constraint billing_webhook_subscription_invoice_facts_subscription_id_check
    check (provider_subscription_id ~ '^[1-9][0-9]*$'),
  constraint billing_webhook_subscription_invoice_facts_customer_id_check
    check (provider_customer_id ~ '^[1-9][0-9]*$'),
  constraint billing_webhook_subscription_invoice_facts_store_id_check
    check (provider_store_id ~ '^[1-9][0-9]*$'),
  constraint billing_webhook_subscription_invoice_facts_reason_check
    check (billing_reason in ('initial', 'renewal', 'updated')),
  constraint billing_webhook_subscription_invoice_facts_status_check
    check (invoice_status = 'paid'),
  constraint billing_webhook_subscription_invoice_facts_timestamp_order_check
    check (provider_invoice_updated_at >= provider_invoice_created_at),
  constraint billing_webhook_subscription_invoice_facts_evidence_status_check
    check (evidence_status = 'recorded')
);

create index billing_webhook_subscription_invoice_facts_subscription_idx
  on public.billing_webhook_subscription_invoice_facts(
    provider, environment, provider_subscription_id, provider_invoice_updated_at
  );

create trigger billing_webhook_subscription_invoice_facts_set_updated_at
before update on public.billing_webhook_subscription_invoice_facts
for each row execute function public.set_updated_at();

alter table public.billing_webhook_subscription_invoice_facts enable row level security;
revoke all on table public.billing_webhook_subscription_invoice_facts
  from public, anon, authenticated, service_role;

create or replace function public.ingest_billing_subscription_invoice_evidence_v1(
  p_provider text,
  p_environment text,
  p_event_name text,
  p_provider_object_type text,
  p_provider_object_id text,
  p_payload_hash text,
  p_semantic_fingerprint text,
  p_test_mode boolean,
  p_provider_invoice_id text,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_store_id text,
  p_billing_reason text,
  p_invoice_status text,
  p_provider_invoice_created_at timestamptz,
  p_provider_invoice_updated_at timestamptz,
  p_now timestamptz default pg_catalog.now()
)
returns table(event_id uuid, outcome text, stored_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.billing_webhook_events%rowtype;
  v_existing public.billing_webhook_subscription_invoice_facts%rowtype;
  v_event_id uuid;
begin
  if p_provider is distinct from 'lemonsqueezy'
     or p_environment not in ('test', 'live')
     or p_event_name is distinct from 'subscription_payment_success'
     or p_provider_object_type is distinct from 'subscription-invoices'
     or p_provider_object_id is distinct from p_provider_invoice_id
     or p_payload_hash is null or not (p_payload_hash ~ '^[0-9a-f]{64}$')
     or p_semantic_fingerprint is null or not (p_semantic_fingerprint ~ '^[0-9a-f]{64}$')
     or p_provider_invoice_id is null or not (p_provider_invoice_id ~ '^[1-9][0-9]*$')
     or p_provider_subscription_id is null or not (p_provider_subscription_id ~ '^[1-9][0-9]*$')
     or p_provider_customer_id is null or not (p_provider_customer_id ~ '^[1-9][0-9]*$')
     or p_provider_store_id is null or not (p_provider_store_id ~ '^[1-9][0-9]*$')
     or p_billing_reason not in ('initial', 'renewal', 'updated')
     or p_invoice_status is distinct from 'paid'
     or p_provider_invoice_created_at is null
     or p_provider_invoice_updated_at is null
     or p_provider_invoice_updated_at < p_provider_invoice_created_at
     or p_now is null
     or (p_environment = 'test' and p_test_mode is distinct from true)
     or (p_environment = 'live' and p_test_mode is distinct from false) then
    raise exception using errcode = '23514', message = 'BILLING_INVOICE_EVIDENCE_CONTRACT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_provider || ':' || p_environment || ':' || p_provider_invoice_id,
      0
    )
  );

  select * into v_event
  from public.billing_webhook_events e
  where e.provider = p_provider
    and e.environment = p_environment
    and (e.payload_hash = p_payload_hash or e.semantic_fingerprint = p_semantic_fingerprint)
  order by e.received_at, e.id
  limit 1;

  if found then
    v_event_id := v_event.id;
    perform 1 from public.billing_webhook_subscription_invoice_facts f
      where f.webhook_event_id = v_event.id;
    if found then
      return query select v_event.id, 'invoice_evidence_already_recorded'::text,
        v_event.processing_status::text;
      return;
    end if;
    if v_event.event_name is distinct from p_event_name
       or v_event.provider_object_type is distinct from p_provider_object_type
       or v_event.provider_object_id is distinct from p_provider_object_id then
      update public.billing_webhook_events
      set processing_status='manual_review', processed_at=p_now,
          error_code='invoice_evidence_source_event_conflict',
          last_processing_outcome='invoice_evidence_conflict', updated_at=p_now
      where id=v_event.id;
      return query select v_event.id, 'invoice_evidence_conflict'::text, 'manual_review'::text;
      return;
    end if;
  end if;

  select * into v_existing
  from public.billing_webhook_subscription_invoice_facts f
  where f.provider = p_provider
    and f.environment = p_environment
    and f.provider_invoice_id = p_provider_invoice_id
  for update;

  if found then
    if v_existing.provider_subscription_id = p_provider_subscription_id
       and v_existing.provider_customer_id = p_provider_customer_id
       and v_existing.provider_store_id = p_provider_store_id
       and v_existing.billing_reason = p_billing_reason
       and v_existing.invoice_status = p_invoice_status
       and v_existing.provider_invoice_created_at = p_provider_invoice_created_at
       and v_existing.provider_invoice_updated_at = p_provider_invoice_updated_at then
      if v_event_id is null then
        insert into public.billing_webhook_events(
          provider, environment, event_name, provider_object_type, provider_object_id,
          payload_hash, semantic_fingerprint, processing_status, processed_at,
          last_processing_outcome
        ) values (
          p_provider, p_environment, p_event_name, p_provider_object_type, p_provider_object_id,
          p_payload_hash, p_semantic_fingerprint, 'processed', p_now,
          'invoice_evidence_already_recorded'
        ) returning id into v_event_id;
      else
        update public.billing_webhook_events
        set processing_status='processed', processed_at=p_now, error_code=null,
            last_processing_outcome='invoice_evidence_already_recorded', updated_at=p_now
        where id=v_event_id;
      end if;
      return query select v_event_id, 'invoice_evidence_already_recorded'::text, 'processed'::text;
      return;
    end if;

    if v_event_id is null then
      insert into public.billing_webhook_events(
        provider, environment, event_name, provider_object_type, provider_object_id,
        payload_hash, semantic_fingerprint, processing_status, processed_at, error_code,
        last_processing_outcome
      ) values (
        p_provider, p_environment, p_event_name, p_provider_object_type, p_provider_object_id,
        p_payload_hash, p_semantic_fingerprint, 'manual_review', p_now,
        'invoice_evidence_identity_conflict', 'invoice_evidence_conflict'
      ) returning id into v_event_id;
    else
      update public.billing_webhook_events
      set processing_status='manual_review', processed_at=p_now,
          error_code='invoice_evidence_identity_conflict',
          last_processing_outcome='invoice_evidence_conflict', updated_at=p_now
      where id=v_event_id;
    end if;
    return query select v_event_id, 'invoice_evidence_conflict'::text, 'manual_review'::text;
    return;
  end if;

  if v_event_id is null then
    insert into public.billing_webhook_events(
      provider, environment, event_name, provider_object_type, provider_object_id,
      payload_hash, semantic_fingerprint, processing_status, processed_at,
      last_processing_outcome
    ) values (
      p_provider, p_environment, p_event_name, p_provider_object_type, p_provider_object_id,
      p_payload_hash, p_semantic_fingerprint, 'processed', p_now,
      'invoice_evidence_recorded'
    ) returning id into v_event_id;
  else
    update public.billing_webhook_events
    set processing_status='processed', processed_at=p_now, error_code=null,
        last_processing_outcome='invoice_evidence_recorded', updated_at=p_now
    where id=v_event_id;
  end if;

  insert into public.billing_webhook_subscription_invoice_facts(
    webhook_event_id, provider, environment, provider_invoice_id,
    provider_subscription_id, provider_customer_id, provider_store_id,
    billing_reason, invoice_status, provider_invoice_created_at,
    provider_invoice_updated_at
  ) values (
    v_event_id, p_provider, p_environment, p_provider_invoice_id,
    p_provider_subscription_id, p_provider_customer_id, p_provider_store_id,
    p_billing_reason, p_invoice_status, p_provider_invoice_created_at,
    p_provider_invoice_updated_at
  );

  return query select v_event_id, 'invoice_evidence_recorded'::text, 'processed'::text;
end;
$$;

alter function public.ingest_billing_subscription_invoice_evidence_v1(
  text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz
) owner to postgres;
revoke all on function public.ingest_billing_subscription_invoice_evidence_v1(
  text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.ingest_billing_subscription_invoice_evidence_v1(
  text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz
) to service_role;

comment on table public.billing_webhook_subscription_invoice_facts is
  'Server-only, PII-minimized Subscription Invoice evidence. It contains no raw payload, payment method, URLs, amounts, or inferred subscription period.';
comment on function public.ingest_billing_subscription_invoice_evidence_v1(
  text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz
) is
  'Atomically records a terminal payment-success webhook event and canonical invoice evidence; it never reads or mutates subscriptions or checkout ledgers.';

commit;

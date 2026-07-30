begin;

create index billing_webhook_events_retry_claim_environment_idx
  on public.billing_webhook_events (
    environment,
    (coalesce(next_processing_attempt_at, received_at, created_at)),
    received_at,
    id
  )
  where provider = 'lemonsqueezy'
    and environment in ('test', 'live')
    and processing_status = 'received'
    and event_name in ('subscription_created', 'subscription_updated');

create or replace function public.claim_pending_billing_webhook_events_v2(
  p_environment text,
  p_batch_size integer default 10,
  p_now timestamptz default pg_catalog.now(),
  p_lease_duration interval default interval '5 minutes'
)
returns table(
  webhook_event_id uuid,
  event_name text,
  environment text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_WORKER_ENVIRONMENT_INVALID';
  end if;
  if p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_WORKER_NOW_REQUIRED';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 20 then
    raise exception using errcode = '22023', message = 'BILLING_WORKER_BATCH_SIZE_INVALID';
  end if;
  if p_lease_duration is null
     or p_lease_duration < interval '30 seconds'
     or p_lease_duration > interval '10 minutes' then
    raise exception using errcode = '22023', message = 'BILLING_WORKER_LEASE_DURATION_INVALID';
  end if;

  update public.billing_webhook_events e
  set next_processing_attempt_at = null,
      updated_at = p_now
  where e.provider = 'lemonsqueezy'
    and e.environment = p_environment
    and e.processing_status <> 'received'
    and e.next_processing_attempt_at is not null;

  update public.billing_webhook_events e
  set processing_lease_until = null,
      processing_claim_token = null,
      updated_at = p_now
  where e.provider = 'lemonsqueezy'
    and e.environment = p_environment
    and e.processing_status <> 'received'
    and e.processing_lease_until is not null
    and e.processing_lease_until <= p_now;

  update public.billing_webhook_events e
  set processing_status = 'manual_review',
      error_code = 'processor_retry_exhausted',
      processed_at = p_now,
      next_processing_attempt_at = null,
      processing_lease_until = null,
      processing_claim_token = null,
      last_processing_outcome = 'retry_exhausted',
      updated_at = p_now
  where e.provider = 'lemonsqueezy'
    and e.environment = p_environment
    and e.processing_status = 'received'
    and e.event_name in ('subscription_created', 'subscription_updated')
    and e.processing_attempt_count >= 7
    and (e.processing_lease_until is null or e.processing_lease_until <= p_now);

  return query
  with eligible as (
    select e.id, e.event_name, e.environment
    from public.billing_webhook_events e
    where e.provider = 'lemonsqueezy'
      and e.environment = p_environment
      and e.processing_status = 'received'
      and e.event_name in ('subscription_created', 'subscription_updated')
      and e.processing_attempt_count < 7
      and coalesce(e.next_processing_attempt_at, e.received_at, e.created_at) <= p_now
      and (e.processing_lease_until is null or e.processing_lease_until <= p_now)
      and (
        e.event_name = 'subscription_created'
        or not exists (
          select 1
          from public.billing_webhook_subscription_facts updated_facts
          join public.billing_webhook_subscription_facts created_facts
            on created_facts.provider_subscription_id = updated_facts.provider_subscription_id
          join public.billing_webhook_events created_event
            on created_event.id = created_facts.webhook_event_id
          where updated_facts.webhook_event_id = e.id
            and created_event.provider = e.provider
            and created_event.environment = e.environment
            and created_event.event_name = 'subscription_created'
            and created_event.processing_status = 'received'
        )
      )
    order by
      case when e.event_name = 'subscription_created' then 0 else 1 end,
      coalesce(e.next_processing_attempt_at, e.received_at, e.created_at),
      e.received_at,
      e.id
    for update of e skip locked
    limit p_batch_size
  ), claimed as (
    update public.billing_webhook_events e
    set processing_attempt_count = e.processing_attempt_count + 1,
        last_processing_attempt_at = p_now,
        next_processing_attempt_at = null,
        processing_lease_until = p_now + p_lease_duration,
        processing_claim_token = extensions.gen_random_uuid(),
        last_processing_outcome = 'claimed',
        updated_at = p_now
    from eligible
    where e.id = eligible.id
    returning e.id, e.event_name, e.environment, e.processing_claim_token
  )
  select claimed.id, claimed.event_name, claimed.environment, claimed.processing_claim_token
  from claimed;
end;
$$;

alter function public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)
  owner to postgres;
revoke all on function public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)
  from public, anon, authenticated;
grant execute on function public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)
  to service_role;

comment on function public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval) is
  'Claims only received Lemon Squeezy subscription lifecycle events for one trusted test or live environment; dependency lookup and leases are environment-isolated.';

commit;

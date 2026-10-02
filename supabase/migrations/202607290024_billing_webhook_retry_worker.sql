begin;

alter table public.billing_webhook_events
  add column processing_attempt_count integer not null default 0,
  add column last_processing_attempt_at timestamptz,
  add column next_processing_attempt_at timestamptz,
  add column last_processing_outcome text,
  add column processing_lease_until timestamptz,
  add column processing_claim_token uuid;

alter table public.billing_webhook_events
  add constraint billing_webhook_events_attempt_count_check
    check (processing_attempt_count >= 0),
  add constraint billing_webhook_events_lease_token_pair_check
    check (
      (processing_lease_until is null and processing_claim_token is null)
      or
      (processing_lease_until is not null and processing_claim_token is not null)
    );

update public.billing_webhook_events
set processing_attempt_count = 0,
    next_processing_attempt_at = case
      when provider = 'lemonsqueezy'
       and environment = 'test'
       and processing_status = 'received'
       and event_name in ('subscription_created', 'subscription_updated')
      then coalesce(received_at, created_at)
      else null
    end;

create index billing_webhook_events_retry_claim_idx
  on public.billing_webhook_events (
    (coalesce(next_processing_attempt_at, received_at, created_at)),
    received_at,
    id
  )
  where provider = 'lemonsqueezy'
    and environment = 'test'
    and processing_status = 'received'
    and event_name in ('subscription_created', 'subscription_updated');

create or replace function public.claim_pending_billing_webhook_events_v1(
  p_batch_size integer default 10,
  p_now timestamptz default pg_catalog.now(),
  p_lease_duration interval default interval '5 minutes'
)
returns table(
  webhook_event_id uuid,
  event_name text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  where e.processing_status <> 'received'
    and e.next_processing_attempt_at is not null;

  update public.billing_webhook_events e
  set processing_lease_until = null,
      processing_claim_token = null,
      updated_at = p_now
  where e.processing_status <> 'received'
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
    and e.environment = 'test'
    and e.processing_status = 'received'
    and e.event_name in ('subscription_created', 'subscription_updated')
    and e.processing_attempt_count >= 7
    and (e.processing_lease_until is null or e.processing_lease_until <= p_now);

  return query
  with eligible as (
    select e.id, e.event_name
    from public.billing_webhook_events e
    where e.provider = 'lemonsqueezy'
      and e.environment = 'test'
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
            and created_event.provider = 'lemonsqueezy'
            and created_event.environment = 'test'
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
    returning e.id, e.event_name, e.processing_claim_token
  )
  select claimed.id, claimed.event_name, claimed.processing_claim_token
  from claimed;
end;
$$;

revoke all on function public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval)
  from public, anon, authenticated;
grant execute on function public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval)
  to service_role;

create or replace function public.finalize_billing_webhook_processing_attempt_v1(
  p_webhook_event_id uuid,
  p_claim_token uuid,
  p_worker_outcome text,
  p_now timestamptz default pg_catalog.now()
)
returns table(outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.billing_webhook_events%rowtype;
  v_next_attempt_at timestamptz;
begin
  if p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_WORKER_NOW_REQUIRED';
  end if;
  if p_worker_outcome is null or p_worker_outcome not in (
    'processed', 'already_processed', 'already_applied', 'stale_ignored',
    'manual_review', 'dependency_pending', 'transient_error', 'unknown_outcome'
  ) then
    raise exception using errcode = '22023', message = 'BILLING_WORKER_OUTCOME_INVALID';
  end if;

  select * into v_event
  from public.billing_webhook_events e
  where e.id = p_webhook_event_id
  for update;

  if not found
     or p_claim_token is null
     or v_event.processing_claim_token is distinct from p_claim_token then
    return query select 'claim_lost'::text;
    return;
  end if;

  if v_event.processing_status = 'processed' then
    update public.billing_webhook_events
    set processing_lease_until = null,
        processing_claim_token = null,
        next_processing_attempt_at = null,
        last_processing_outcome = p_worker_outcome,
        updated_at = p_now
    where id = v_event.id;
    return query select 'finalized_terminal'::text;
    return;
  end if;

  if v_event.processing_status in ('manual_review', 'ignored') then
    update public.billing_webhook_events
    set processing_lease_until = null,
        processing_claim_token = null,
        next_processing_attempt_at = null,
        last_processing_outcome = p_worker_outcome,
        updated_at = p_now
    where id = v_event.id;
    return query select case
      when v_event.processing_status = 'manual_review' then 'manual_review'::text
      else 'finalized_terminal'::text
    end;
    return;
  end if;

  if v_event.processing_status <> 'received' then
    update public.billing_webhook_events
    set processing_lease_until = null,
        processing_claim_token = null,
        next_processing_attempt_at = null,
        last_processing_outcome = p_worker_outcome,
        updated_at = p_now
    where id = v_event.id;
    return query select 'finalized_terminal'::text;
    return;
  end if;

  if p_worker_outcome in ('dependency_pending', 'transient_error') then
    if v_event.processing_attempt_count >= 7 then
      update public.billing_webhook_events
      set processing_status = 'manual_review',
          error_code = 'processor_retry_exhausted',
          processed_at = p_now,
          next_processing_attempt_at = null,
          processing_lease_until = null,
          processing_claim_token = null,
          last_processing_outcome = 'retry_exhausted',
          updated_at = p_now
      where id = v_event.id;
      return query select 'retry_exhausted'::text;
      return;
    end if;

    v_next_attempt_at := p_now + case v_event.processing_attempt_count
      when 1 then interval '1 minute'
      when 2 then interval '5 minutes'
      when 3 then interval '15 minutes'
      when 4 then interval '1 hour'
      when 5 then interval '6 hours'
      when 6 then interval '24 hours'
      else interval '1 minute'
    end;
    update public.billing_webhook_events
    set processed_at = null,
        next_processing_attempt_at = v_next_attempt_at,
        processing_lease_until = null,
        processing_claim_token = null,
        last_processing_outcome = p_worker_outcome,
        updated_at = p_now
    where id = v_event.id;
    return query select 'retry_scheduled'::text;
    return;
  end if;

  if p_worker_outcome = 'unknown_outcome' then
    update public.billing_webhook_events
    set processing_status = 'manual_review',
        error_code = 'processor_worker_outcome_unknown',
        processed_at = p_now,
        next_processing_attempt_at = null,
        processing_lease_until = null,
        processing_claim_token = null,
        last_processing_outcome = 'unknown_outcome',
        updated_at = p_now
    where id = v_event.id;
    return query select 'manual_review'::text;
    return;
  end if;

  update public.billing_webhook_events
  set processing_status = 'manual_review',
      error_code = 'processor_worker_state_mismatch',
      processed_at = p_now,
      next_processing_attempt_at = null,
      processing_lease_until = null,
      processing_claim_token = null,
      last_processing_outcome = 'state_mismatch',
      updated_at = p_now
  where id = v_event.id;
  return query select 'manual_review'::text;
end;
$$;

revoke all on function public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz)
  to service_role;

comment on function public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval) is
  'Claims only received Lemon Squeezy test subscription_created and subscription_updated events for bounded server-side retry processing.';
comment on function public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz) is
  'Finalizes one leased billing webhook processing attempt using database status as authority and sanitized retry outcomes only.';

commit;

begin;

-- E1: resubscribe (Starter/Pro monthly) after a verified terminal expiry of the previous provider
-- subscription. Default-off: acquisition only offers it when the server passes
-- p_allow_resubscribe = true (BILLING_RESUBSCRIBE_ENABLED); activation of an already issued
-- resubscribe checkout does not depend on the flag, because that purchase may have been paid.
--
-- Model. public.subscriptions stays the single current row per salon (every reader and writer keeps
-- its salon cardinality). A superseded provider identity is moved, append-only, to
-- billing_subscription_provider_generations; the current generation is 1 + that row count. A
-- resubscribe checkout is bound (immutably) to the provider subscription id and generation that
-- were current and terminal when the intent was acquired. Only a verified, correlated
-- subscription_created for that checkout may replace exactly that generation.
--
-- Late events of a superseded identity are processed as history ('stale_ignored',
-- last_processing_outcome 'superseded_identity_ignored') by both subscription processors; the
-- authority boundary is the provider identity, never a timestamp. Invoice evidence is keyed by the
-- provider subscription id and is unchanged: C1 and C2 only read invoices of the identity they
-- belong to.
--
-- Lock protocol: unchanged prefixes (acquisition: intent advisory -> checkout rows -> subscription
-- -> plan(share) -> employee-capacity advisory; created processor: event -> facts -> checkout ->
-- plan(share) -> mapping(share) -> subscription -> employee-capacity advisory). The generation row
-- is written last, under the subscription lock. Reads of plan changes, overrides and events take no
-- locks; their writers serialise on the subscription row or the checkout rows held here.

-- ---------------------------------------------------------------------------
-- Superseded provider identities (append-only)
-- ---------------------------------------------------------------------------

create table public.billing_subscription_provider_generations (
  id uuid primary key default extensions.gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  salon_id uuid not null references public.salons(id) on delete restrict,
  generation integer not null,
  provider text not null,
  environment text not null,
  provider_subscription_id text not null,
  provider_customer_id text not null,
  plan_id uuid not null references public.plans(id) on delete restrict,
  final_status public.subscription_status not null,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancelled_at timestamptz,
  provider_state_updated_at timestamptz not null,
  provider_last_webhook_event_id uuid,
  superseded_at timestamptz not null,
  superseded_by_provider_subscription_id text not null,
  superseded_by_checkout_session_id uuid not null
    references public.billing_checkout_sessions(id) on delete restrict,
  superseded_by_webhook_event_id uuid not null
    references public.billing_webhook_events(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  constraint billing_provider_generations_provider_check check (provider = 'lemonsqueezy'),
  constraint billing_provider_generations_environment_check check (environment in ('test', 'live')),
  constraint billing_provider_generations_generation_check check (generation >= 1),
  constraint billing_provider_generations_terminal_check check (final_status = 'expired'),
  constraint billing_provider_generations_ids_check check (
    provider_subscription_id ~ '[^[:space:]]' and provider_customer_id ~ '[^[:space:]]'
    and superseded_by_provider_subscription_id ~ '[^[:space:]]'
    and superseded_by_provider_subscription_id <> provider_subscription_id)
);

create unique index billing_provider_generations_identity_idx
  on public.billing_subscription_provider_generations(provider, environment, provider_subscription_id);
create unique index billing_provider_generations_sequence_idx
  on public.billing_subscription_provider_generations(subscription_id, generation);
create unique index billing_provider_generations_checkout_idx
  on public.billing_subscription_provider_generations(superseded_by_checkout_session_id);
create index billing_provider_generations_salon_idx
  on public.billing_subscription_provider_generations(salon_id);

alter table public.billing_subscription_provider_generations owner to postgres;
alter table public.billing_subscription_provider_generations enable row level security;
revoke all on table public.billing_subscription_provider_generations
  from public, anon, authenticated, service_role;
grant select on table public.billing_subscription_provider_generations to service_role;
comment on table public.billing_subscription_provider_generations is
  'E1: append-only history of provider subscription identities replaced by a resubscribe. Never exposed to browsers.';

create function private.billing_provider_generation_immutable_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'BILLING_PROVIDER_GENERATION_IMMUTABLE';
end;
$$;

create trigger billing_provider_generations_immutable
before update or delete on public.billing_subscription_provider_generations
for each row execute function private.billing_provider_generation_immutable_v1();

-- ---------------------------------------------------------------------------
-- Resubscribe binding of a checkout intent (immutable after insert)
-- ---------------------------------------------------------------------------

alter table public.billing_checkout_sessions
  add column resubscribe_from_provider_subscription_id text,
  add column resubscribe_from_generation integer;

alter table public.billing_checkout_sessions
  add constraint billing_checkout_sessions_resubscribe_binding_check check (
    (resubscribe_from_provider_subscription_id is null and resubscribe_from_generation is null)
    or (resubscribe_from_provider_subscription_id ~ '[^[:space:]]'
        and resubscribe_from_generation >= 1));

create function private.billing_checkout_resubscribe_binding_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.resubscribe_from_provider_subscription_id is distinct from old.resubscribe_from_provider_subscription_id
     or new.resubscribe_from_generation is distinct from old.resubscribe_from_generation then
    raise exception using errcode = 'P0001', message = 'BILLING_CHECKOUT_RESUBSCRIBE_BINDING_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger billing_checkout_sessions_resubscribe_binding_guard
before update of resubscribe_from_provider_subscription_id, resubscribe_from_generation
on public.billing_checkout_sessions
for each row execute function private.billing_checkout_resubscribe_binding_guard_v1();

revoke all on function private.billing_provider_generation_immutable_v1() from public, anon, authenticated, service_role;
revoke all on function private.billing_checkout_resubscribe_binding_guard_v1() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared, read-only resubscribe rules
-- ---------------------------------------------------------------------------

create function private.billing_subscription_generation_v1(p_subscription_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select 1 + pg_catalog.count(*)::integer
  from public.billing_subscription_provider_generations g
  where g.subscription_id = p_subscription_id;
$$;

-- State-level rule shared by acquisition, the created processor and D activation recovery.
-- Returns null when the current provider identity is verifiably terminal and nothing unresolved is
-- attached to it. A local period end in the past is not terminal evidence: only the expired state
-- written by a verified lifecycle writer (signed subscription_updated or an applied D snapshot) is.
create function private.billing_resubscribe_terminal_reason_v1(
  p_subscription public.subscriptions,
  p_environment text,
  p_now timestamptz
)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_subscription.billing_provider is distinct from 'lemonsqueezy'
     or p_subscription.billing_environment is distinct from p_environment
     or p_subscription.provider_customer_id is null
     or not (p_subscription.provider_customer_id ~ '[^[:space:]]')
     or p_subscription.provider_subscription_id is null
     or not (p_subscription.provider_subscription_id ~ '[^[:space:]]') then
    return 'reconciliation_required';
  end if;
  if p_subscription.status = 'cancelled'::public.subscription_status then
    -- the paid remainder can still be resumed; after it, an expired event must still arrive
    return case when p_subscription.current_period_ends_at > p_now
      then 'cancelled_until_period_end' else 'terminal_state_unconfirmed' end;
  end if;
  if p_subscription.status = 'past_due'::public.subscription_status then
    return 'payment_recovery';
  end if;
  if p_subscription.status in ('active'::public.subscription_status, 'trialing'::public.subscription_status) then
    return 'subscription_active';
  end if;
  if p_subscription.status <> 'expired'::public.subscription_status then
    return 'reconciliation_required';
  end if;
  if p_subscription.provider_state_updated_at is null
     or p_subscription.current_period_ends_at is null
     or p_subscription.current_period_ends_at > p_now then
    return 'terminal_state_unconfirmed';
  end if;
  if not exists (
      select 1
      from public.billing_webhook_events e
      join public.billing_webhook_subscription_facts f on f.webhook_event_id = e.id
      where e.id = p_subscription.provider_last_webhook_event_id
        and e.provider = 'lemonsqueezy' and e.environment = p_environment
        and e.event_name = 'subscription_updated' and e.processing_status = 'processed'
        and f.provider_subscription_id = p_subscription.provider_subscription_id
        and f.provider_customer_id = p_subscription.provider_customer_id
        and f.provider_status = 'expired'
        and f.provider_updated_at = p_subscription.provider_state_updated_at)
     and not exists (
      select 1
      from public.billing_recovery_attempts r
      where r.recovery_kind = 'subscription_snapshot' and r.outcome = 'applied'
        and r.subscription_id = p_subscription.id and r.environment = p_environment
        and r.provider_subscription_id = p_subscription.provider_subscription_id
        and r.applied_state->>'status' = 'expired'
        and r.evidence_provider_updated_at = p_subscription.provider_state_updated_at) then
    return 'terminal_state_unconfirmed';
  end if;
  if exists (
      select 1 from public.billing_subscription_plan_changes c
      where c.subscription_id = p_subscription.id
        and c.status in ('requested', 'unknown', 'confirmed', 'manual_review')) then
    return 'plan_change_unresolved';
  end if;
  return null;
end;
$$;

-- Purchase-level rule, only for opening a new intent: anything that may already be (part of) a
-- purchase blocks a new checkout. A creating/open intent bound to the current generation is not a
-- blocker: acquisition resumes it.
create function private.billing_resubscribe_acquisition_reason_v1(
  p_subscription public.subscriptions,
  p_environment text,
  p_now timestamptz
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_generation integer := private.billing_subscription_generation_v1(p_subscription.id);
begin
  if exists (
      select 1 from public.billing_access_overrides o
      where o.salon_id = p_subscription.salon_id and o.enabled = true
        and o.starts_at <= p_now and (o.ends_at is null or o.ends_at > p_now)) then
    return 'override_active';
  end if;
  if exists (select 1 from public.resolve_billing_purchase_activation_v1(p_subscription.salon_id)) then
    return 'purchase_activation_pending';
  end if;
  -- a signed lifecycle event for a provider subscription of this salon that is neither the current
  -- identity nor a superseded one, and that was never activated
  if exists (
      select 1
      from public.billing_webhook_events e
      join public.billing_webhook_subscription_facts f on f.webhook_event_id = e.id
      where e.provider = 'lemonsqueezy' and e.environment = p_environment
        and e.provider_object_type = 'subscriptions'
        and e.event_name in ('subscription_created', 'subscription_updated')
        and e.processing_status in ('received', 'manual_review')
        and f.custom_salon_id = p_subscription.salon_id
        and f.provider_subscription_id is distinct from p_subscription.provider_subscription_id
        and not exists (
          select 1 from public.billing_subscription_provider_generations g
          where g.provider = 'lemonsqueezy' and g.environment = p_environment
            and g.provider_subscription_id = f.provider_subscription_id)) then
    return 'purchase_activation_pending';
  end if;
  -- completed ambiguity: a resubscribe of this generation completed, yet the identity did not move
  if exists (
      select 1 from public.billing_checkout_sessions c
      where c.salon_id = p_subscription.salon_id and c.provider = 'lemonsqueezy'
        and c.environment = p_environment and c.status = 'completed'
        and c.resubscribe_from_provider_subscription_id = p_subscription.provider_subscription_id) then
    return 'reconciliation_required';
  end if;
  -- an in-flight intent of another kind or generation is never resumed or replaced here
  if exists (
      select 1 from public.billing_checkout_sessions c
      where c.salon_id = p_subscription.salon_id and c.provider = 'lemonsqueezy'
        and c.environment = p_environment and c.status in ('creating', 'open')
        and (c.resubscribe_from_provider_subscription_id is distinct from p_subscription.provider_subscription_id
             or c.resubscribe_from_generation is distinct from v_generation)) then
    return 'reconciliation_required';
  end if;
  return null;
end;
$$;

revoke all on function private.billing_subscription_generation_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function private.billing_resubscribe_terminal_reason_v1(public.subscriptions, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.billing_resubscribe_acquisition_reason_v1(public.subscriptions, text, timestamptz)
  from public, anon, authenticated, service_role;

-- Read-only owner eligibility for the billing overview. Acquisition re-checks everything under its
-- locks; this never mutates and never calls the provider.
create function public.resolve_billing_resubscribe_eligibility_v1(
  p_salon_id uuid,
  p_actor_profile_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table(eligible boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_environment text;
  v_runtime_config_count integer;
  v_subscription_count integer;
  v_subscription public.subscriptions%rowtype;
  v_reason text;
begin
  if p_salon_id is null or p_actor_profile_id is null or p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_RESUBSCRIBE_ARGUMENT_REQUIRED';
  end if;
  select pg_catalog.count(*), pg_catalog.min(c.environment)
    into v_runtime_config_count, v_environment
  from private.billing_runtime_config c;
  if v_runtime_config_count <> 1 or v_environment not in ('test', 'live') then
    return query select false, 'unavailable'::text;
    return;
  end if;
  if not exists (select 1 from public.salons s where s.id = p_salon_id and s.owner_id = p_actor_profile_id) then
    return query select false, 'not_owner'::text;
    return;
  end if;
  select pg_catalog.count(*) into v_subscription_count
  from public.subscriptions s where s.salon_id = p_salon_id;
  if v_subscription_count <> 1 then
    return query select false, 'reconciliation_required'::text;
    return;
  end if;
  select * into v_subscription from public.subscriptions s where s.salon_id = p_salon_id;
  if v_subscription.billing_provider is null and v_subscription.billing_environment is null
     and v_subscription.provider_customer_id is null and v_subscription.provider_subscription_id is null then
    -- internal trial, legacy provider-free or pilot state: not a resubscribe (E2 handover)
    return query select false, 'not_applicable'::text;
    return;
  end if;
  v_reason := coalesce(
    private.billing_resubscribe_terminal_reason_v1(v_subscription, v_environment, p_now),
    private.billing_resubscribe_acquisition_reason_v1(v_subscription, v_environment, p_now));
  return query select v_reason is null, v_reason;
end;
$$;

alter function public.resolve_billing_resubscribe_eligibility_v1(uuid, uuid, timestamptz) owner to postgres;
revoke all on function public.resolve_billing_resubscribe_eligibility_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_billing_resubscribe_eligibility_v1(uuid, uuid, timestamptz) to service_role;
comment on function public.resolve_billing_resubscribe_eligibility_v1(uuid, uuid, timestamptz) is
  'E1 read-only: whether the salon owner may open a resubscribe checkout now (verified terminal expiry, nothing unresolved). Reason codes only; no provider identifiers.';

-- ---------------------------------------------------------------------------
-- Review tokens cover the provider generation (D snapshot and event reprocess).
-- ---------------------------------------------------------------------------

create or replace function private.billing_subscription_state_fingerprint_v1(p_subscription public.subscriptions)
returns text
language sql
stable
set search_path = ''
as $$
  select private.billing_sha256_v1(pg_catalog.jsonb_build_object(
    'id', p_subscription.id,
    'generation', private.billing_subscription_generation_v1(p_subscription.id),
    'plan_id', p_subscription.plan_id,
    'status', p_subscription.status,
    'billing_provider', p_subscription.billing_provider,
    'billing_environment', p_subscription.billing_environment,
    'provider_subscription_id', p_subscription.provider_subscription_id,
    'provider_customer_id', p_subscription.provider_customer_id,
    'current_period_starts_at', private.billing_epoch_v1(p_subscription.current_period_starts_at),
    'current_period_ends_at', private.billing_epoch_v1(p_subscription.current_period_ends_at),
    'cancel_at_period_end', p_subscription.cancel_at_period_end,
    'cancelled_at', private.billing_epoch_v1(p_subscription.cancelled_at),
    'provider_state_updated_at', private.billing_epoch_v1(p_subscription.provider_state_updated_at),
    'plan_change', (
      select pg_catalog.jsonb_build_object(
        'id', c.id, 'status', c.status,
        'confirmed', private.billing_epoch_v1(c.confirmed_provider_updated_at),
        'observed', private.billing_epoch_v1(c.observed_provider_updated_at),
        'from_seen', private.billing_epoch_v1(c.latest_from_observed_at),
        'updated_at', private.billing_epoch_v1(c.updated_at))
      from public.billing_subscription_plan_changes c
      where c.subscription_id = p_subscription.id
        and c.status in ('requested', 'unknown', 'confirmed', 'manual_review'))
  ));
$$;

-- ---------------------------------------------------------------------------
-- Acquisition v3: v2 plus the default-off resubscribe branch. v2 is now a wrapper with the
-- resubscribe branch disabled, so both share one implementation.
-- ---------------------------------------------------------------------------

create function public.acquire_billing_checkout_intent_v3(
  p_salon_id uuid,
  p_actor_profile_id uuid,
  p_requested_plan_id uuid,
  p_provider text,
  p_allow_resubscribe boolean
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
  v_resubscribe boolean := false;
  v_generation integer;
  v_reason text;
begin
  if p_salon_id is null or p_actor_profile_id is null
     or p_requested_plan_id is null or p_provider is null or p_allow_resubscribe is null then
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
  elsif v_subscription.status='expired'::public.subscription_status and p_allow_resubscribe then
    -- E1: a new purchase after a verified terminal expiry, bound to exactly this generation.
    v_reason := coalesce(
      private.billing_resubscribe_terminal_reason_v1(v_subscription, v_environment, v_now),
      private.billing_resubscribe_acquisition_reason_v1(v_subscription, v_environment, v_now));
    if v_reason is not null then
      raise exception using errcode='P0001', message=case v_reason
        when 'terminal_state_unconfirmed' then 'BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED'
        when 'plan_change_unresolved' then 'BILLING_RESUBSCRIBE_PLAN_CHANGE_UNRESOLVED'
        when 'override_active' then 'BILLING_OVERRIDE_ACTIVE'
        when 'purchase_activation_pending' then 'BILLING_PURCHASE_ACTIVATION_PENDING'
        else 'BILLING_RECONCILIATION_REQUIRED_RESUBSCRIBE_STATE' end;
    end if;
    if not exists (
      select 1 from public.plans p
      where p.id=p_requested_plan_id and p.slug in ('starter','pro') and p.is_active
    ) then
      raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_ACQUIRE_IDENTITY';
    end if;
    v_resubscribe := true;
    v_generation := private.billing_subscription_generation_v1(v_subscription.id);
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
      salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status,
      resubscribe_from_provider_subscription_id,resubscribe_from_generation
    ) values (
      p_salon_id,p_actor_profile_id,p_requested_plan_id,p_provider,v_environment,
      extensions.gen_random_uuid(),'creating',
      case when v_resubscribe then v_subscription.provider_subscription_id end,
      case when v_resubscribe then v_generation end
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
  -- An existing intent is resumed only for the same purchase kind and generation.
  if v_checkout.resubscribe_from_provider_subscription_id is distinct from
       (case when v_resubscribe then v_subscription.provider_subscription_id end)
     or v_checkout.resubscribe_from_generation is distinct from
       (case when v_resubscribe then v_generation end) then
    raise exception using errcode='P0001', message='BILLING_RECONCILIATION_REQUIRED_CHECKOUT_BINDING';
  end if;

  return query select
    case when v_created then 'created' else 'existing' end::text,
    v_checkout.id,v_checkout.idempotency_key,v_checkout.status::text,
    v_checkout.requested_plan_id,v_checkout.actor_profile_id,
    v_checkout.provider,v_checkout.environment,v_checkout.provider_session_id,v_checkout.expires_at;
end;
$$;

alter function public.acquire_billing_checkout_intent_v3(uuid,uuid,uuid,text,boolean) owner to postgres;
revoke all on function public.acquire_billing_checkout_intent_v3(uuid,uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_billing_checkout_intent_v3(uuid,uuid,uuid,text,boolean)
  to service_role;
comment on function public.acquire_billing_checkout_intent_v3(uuid,uuid,uuid,text,boolean) is
  'Service-role atomic checkout acquisition (v2 contract). With p_allow_resubscribe = true an expired provider-linked subscription with verified terminal evidence and nothing unresolved gets a new intent bound to its provider subscription id and generation; no trial is granted.';

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
language sql
security definer
set search_path = ''
as $$
  select * from public.acquire_billing_checkout_intent_v3(
    p_salon_id, p_actor_profile_id, p_requested_plan_id, p_provider, false);
$$;

comment on function public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text) is
  'Service-role atomic checkout acquisition without resubscribe (acquire_billing_checkout_intent_v3 with p_allow_resubscribe = false).';

-- ---------------------------------------------------------------------------
-- Created activation: narrow replacement of a terminal generation; superseded identities ignored.
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
  v_superseded_salon uuid;
  v_replace boolean := false;
  v_terminal_reason text;
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

  -- E1: a provider subscription that a resubscribe already superseded is history only. The event
  -- stays recorded; it never touches the current subscription, its checkout or capacity.
  select g.salon_id into v_superseded_salon
  from public.billing_subscription_provider_generations g
  where g.provider = 'lemonsqueezy' and g.environment = v_event.environment
    and g.provider_subscription_id = v_facts.provider_subscription_id;
  if v_superseded_salon is not null then
    update public.billing_webhook_events
    set processing_status='processed', processed_at=p_now, error_code=null,
        last_processing_outcome='superseded_identity_ignored',
        salon_id=v_superseded_salon, updated_at=p_now
    where id=v_event.id;
    return query select 'stale_ignored'::text, null::text;
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

  -- E1: a resubscribe checkout may replace exactly the terminal generation it was issued for.
  if v_checkout.resubscribe_from_provider_subscription_id is not null
     and v_checkout.status <> 'completed'
     and v_subscription.provider_subscription_id is distinct from v_facts.provider_subscription_id then
    if v_subscription.provider_subscription_id is distinct from v_checkout.resubscribe_from_provider_subscription_id
       or private.billing_subscription_generation_v1(v_subscription.id)
          is distinct from v_checkout.resubscribe_from_generation then
      update public.billing_webhook_events
      set processing_status='manual_review', processed_at=p_now,
          error_code='processor_resubscribe_generation_conflict',
          salon_id=v_checkout.salon_id, updated_at=p_now
      where id=v_event.id;
      return query select 'manual_review'::text, 'processor_resubscribe_generation_conflict'::text;
      return;
    end if;
    v_terminal_reason := private.billing_resubscribe_terminal_reason_v1(
      v_subscription, v_event.environment, p_now);
    if v_terminal_reason is not null then
      update public.billing_webhook_events
      set processing_status='manual_review', processed_at=p_now,
          error_code='processor_resubscribe_previous_not_terminal',
          salon_id=v_checkout.salon_id, updated_at=p_now
      where id=v_event.id;
      return query select 'manual_review'::text, 'processor_resubscribe_previous_not_terminal'::text;
      return;
    end if;
    v_replace := true;
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

  -- A replacement keeps the provider/environment checks (done by the terminal check) but accepts
  -- the customer and subscription of the verified, correlated new checkout.
  if v_conflict
     or (not v_replace and (
       (v_subscription.billing_provider is not null
         and v_subscription.billing_provider<>'lemonsqueezy')
       or (v_subscription.billing_environment is not null
         and v_subscription.billing_environment is distinct from v_event.environment)
       or (v_subscription.provider_customer_id is not null
         and v_subscription.provider_customer_id<>v_facts.provider_customer_id)
       or (v_subscription.provider_subscription_id is not null
         and v_subscription.provider_subscription_id<>v_facts.provider_subscription_id))) then
    update public.billing_webhook_events
    set processing_status='manual_review', processed_at=p_now,
        error_code='processor_provider_ownership_conflict', updated_at=p_now
    where id=v_event.id;
    return query select 'manual_review'::text, 'processor_provider_ownership_conflict'::text;
    return;
  end if;

  -- Ordering is per provider identity: the new subscription's version is never compared with
  -- the superseded identity's provider_state_updated_at.
  if not v_replace and v_subscription.provider_state_updated_at is not null
     and v_facts.provider_updated_at < v_subscription.provider_state_updated_at then
    update public.billing_webhook_events
    set processing_status='processed', processed_at=p_now,
        error_code=null, updated_at=p_now
    where id=v_event.id;
    return query select 'stale_ignored'::text, null::text;
    return;
  end if;

  if not v_replace and v_subscription.provider_state_updated_at = v_facts.provider_updated_at then
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

  -- E1: keep the terminal identity before the current row moves to the new one.
  if v_replace then
    insert into public.billing_subscription_provider_generations(
      subscription_id, salon_id, generation, provider, environment,
      provider_subscription_id, provider_customer_id, plan_id, final_status,
      current_period_starts_at, current_period_ends_at, cancelled_at,
      provider_state_updated_at, provider_last_webhook_event_id,
      superseded_at, superseded_by_provider_subscription_id,
      superseded_by_checkout_session_id, superseded_by_webhook_event_id
    ) values (
      v_subscription.id, v_subscription.salon_id, v_checkout.resubscribe_from_generation,
      v_subscription.billing_provider, v_subscription.billing_environment,
      v_subscription.provider_subscription_id, v_subscription.provider_customer_id,
      v_subscription.plan_id, v_subscription.status,
      v_subscription.current_period_starts_at, v_subscription.current_period_ends_at,
      v_subscription.cancelled_at, v_subscription.provider_state_updated_at,
      v_subscription.provider_last_webhook_event_id,
      p_now, v_facts.provider_subscription_id, v_checkout.id, v_event.id
    );
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
  'Confirms an already-issued Lemon Squeezy checkout in the locked event environment. A resubscribe checkout replaces only the verified terminal generation it is bound to (the previous identity is kept in billing_subscription_provider_generations); a superseded provider subscription is recorded as history and changes nothing. The activating branch re-checks the target employee limit under the capacity lock.';

-- ---------------------------------------------------------------------------
-- Updated processor: late deliveries of a superseded identity are history only.
-- ---------------------------------------------------------------------------

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
  v_change public.billing_subscription_plan_changes%rowtype;
  v_mapping_count integer := 0;
  v_expected_target boolean := false;
  v_expected_status public.subscription_status;
  v_expected_period_end timestamptz;
  v_expected_cancel_at_period_end boolean;
  v_expected_cancelled_at timestamptz;
  v_error_code text;
  v_superseded_salon uuid;
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
    -- E1: a late delivery of a superseded provider subscription (even with a newer updated_at)
    -- is recorded as history and never touches the current subscription.
    select g.salon_id into v_superseded_salon
    from public.billing_subscription_provider_generations g
    where g.provider = 'lemonsqueezy' and g.environment = v_event.environment
      and g.provider_subscription_id = v_facts.provider_subscription_id;
    if v_superseded_salon is not null then
      update public.billing_webhook_events
      set processing_status='processed', processed_at=p_now, error_code=null,
          last_processing_outcome='superseded_identity_ignored',
          salon_id=v_superseded_salon, updated_at=p_now
      where id=v_event.id;
      return query select 'stale_ignored'::text, null::text;
      return;
    end if;
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

  -- C2: an unresolved plan change makes exactly its recorded target variant expected.
  select * into v_change
  from public.billing_subscription_plan_changes
  where subscription_id=v_subscription.id
    and status in ('requested','unknown','confirmed','manual_review')
  for update;
  v_expected_target := v_change.id is not null
    and v_facts.provider_store_id is not distinct from v_change.provider_store_id
    and v_facts.provider_product_id is not distinct from v_change.target_provider_product_id
    and v_facts.provider_variant_id is not distinct from v_change.target_provider_variant_id;

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
  elsif v_mapping_count<>1 and not v_expected_target then
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
    if v_change.id is not null then
      perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_variant_unexpected');
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

  -- C2: every verified, identity- and mapping-checked delivery contributes confirmation facts,
  -- including stale or late ones, so E1/E2/E3 arrival order does not change the outcome.
  if v_change.id is not null then
    perform private.observe_billing_plan_change_v1(
      v_change.id, 'webhook', v_facts.provider_store_id, v_facts.provider_product_id,
      v_facts.provider_variant_id, v_facts.provider_status, v_facts.provider_renews_at,
      v_facts.provider_ends_at, v_facts.provider_updated_at, false, p_now);
  end if;

  if v_subscription.provider_state_updated_at is not null
     and v_facts.provider_updated_at<v_subscription.provider_state_updated_at then
    update public.billing_webhook_events
    set processing_status='processed', processed_at=p_now, error_code=null,
        salon_id=v_subscription.salon_id, updated_at=p_now
    where id=v_event.id;
    if v_change.id is not null then
      perform private.evaluate_billing_plan_change_v1(v_subscription.id, p_now);
    end if;
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
    if v_change.id is not null then
      perform private.evaluate_billing_plan_change_v1(v_subscription.id, p_now);
    end if;
    return query select 'manual_review'::text, v_error_code;
    return;
  end if;

  -- C2: an unresolved change caps the paid access period at the immutable baseline. The
  -- provider period is kept on the plan-change row and only the evaluator may lift the cap.
  if v_change.id is not null then
    v_expected_period_end := least(v_expected_period_end, v_change.baseline_period_end);
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
      if v_change.id is not null then
        perform private.evaluate_billing_plan_change_v1(v_subscription.id, p_now);
      end if;
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

  if v_change.id is not null then
    perform private.observe_billing_plan_change_v1(
      v_change.id, 'webhook', v_facts.provider_store_id, v_facts.provider_product_id,
      v_facts.provider_variant_id, v_facts.provider_status, v_facts.provider_renews_at,
      v_facts.provider_ends_at, v_facts.provider_updated_at, true, p_now);
    perform private.evaluate_billing_plan_change_v1(v_subscription.id, p_now);
  end if;

  return query select 'processed'::text, null::text;
end;
$$;

comment on function public.process_billing_subscription_updated_v2(uuid, timestamptz) is
  'Processes a verified Lemon Squeezy subscription_updated event in the environment owned by the locked event row. A delivery for a provider subscription superseded by a resubscribe is processed as history (stale_ignored) whatever its updated_at. With an unresolved plan change the recorded target variant is expected, the paid access period is capped at the immutable baseline and only the shared plan-change evaluator may complete the change.';

-- ---------------------------------------------------------------------------
-- D event reprocess: a parked resubscribe activation is recoverable for its own generation only.
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
        elsif v_checkout.resubscribe_from_provider_subscription_id is null
          and (v_subscription.billing_provider is not null
           or v_subscription.billing_environment is not null
           or v_subscription.provider_customer_id is not null
           or v_subscription.provider_subscription_id is not null) then
          -- never overwrite another provider subscription
          v_verdict := 'conflict';
          v_error := 'recovery_subscription_already_linked';
        elsif v_checkout.resubscribe_from_provider_subscription_id is not null
          and (v_subscription.provider_subscription_id
                 is distinct from v_checkout.resubscribe_from_provider_subscription_id
               or private.billing_subscription_generation_v1(v_subscription.id)
                 is distinct from v_checkout.resubscribe_from_generation
               or private.billing_resubscribe_terminal_reason_v1(v_subscription, p_environment, p_now)
                 is not null) then
          -- E1: a resubscribe activation replaces only the terminal generation it was issued for
          v_verdict := 'conflict';
          v_error := 'recovery_resubscribe_generation_conflict';
        elsif exists (
          select 1 from public.billing_checkout_sessions c
          where c.salon_id = v_checkout.salon_id and c.provider = 'lemonsqueezy'
            and c.environment = p_environment and c.id <> v_checkout.id and c.status = 'completed'
            -- completed checkouts of earlier generations do not compete with a resubscribe
            and (v_checkout.resubscribe_from_provider_subscription_id is null
                 or c.resubscribe_from_provider_subscription_id
                    is not distinct from v_checkout.resubscribe_from_provider_subscription_id)
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

commit;

begin;

-- C2: Starter/Pro plan change effective from the next renewal (database foundation, default-off:
-- no user/provider route calls these RPCs yet).
--
-- Representation. public.subscriptions.current_period_ends_at stays the *paid access* boundary.
-- While a plan change is unresolved ("blocking"), every lifecycle writer caps it at the immutable
-- baseline_period_end and keeps plan_id at the from-plan; the provider period/status/variant that
-- was observed is kept on the plan-change row instead. Only the shared evaluator lifts the cap, and
-- only with E1 (pre-boundary target confirmation), E2 (newer lifecycle state with a renewed target
-- period) and E3 (durable paid renewal invoice). A BEFORE UPDATE guard on subscriptions enforces
-- the cap for every writer. Canonical access (DB and TS) reads the subscription row unchanged.
--
-- Lock protocol (unchanged prefixes, plan-change row inserted after the subscription):
--   updated processor : event -> facts -> subscription -> plan(share) -> mapping(share) -> plan change
--   invoice ingest    : invoice advisory -> event -> invoice facts -> subscription -> plan change
--   snapshot apply    : subscription -> plan(share) -> mapping(share) -> plan change
--   request           : subscription -> plans(share) -> plan change -> employee-capacity advisory
--   provider result / evaluate RPC : subscription -> plan change
--   employee trigger  : employee row -> employee-capacity advisory (reads only, no row locks)
-- No writer takes the subscription after the plan-change row or the capacity lock, and the
-- evaluator never takes the invoice advisory lock.
--
-- Trust boundary: provider evidence passed to the service-role RPCs (pre-request GET, PATCH
-- response, later GET) is trusted as validated by the server adapter, exactly like the D snapshot
-- recovery. The database cannot prove where arbitrary service-role parameters came from.

-- ---------------------------------------------------------------------------
-- Plan-change evidence
-- ---------------------------------------------------------------------------

create table public.billing_subscription_plan_changes (
  id uuid primary key default extensions.gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  salon_id uuid not null references public.salons(id) on delete restrict,
  provider text not null default 'lemonsqueezy',
  environment text not null,
  provider_subscription_id text not null,
  provider_customer_id text not null,
  provider_store_id text not null,
  direction text not null,
  from_plan_id uuid not null references public.plans(id) on delete restrict,
  target_plan_id uuid not null references public.plans(id) on delete restrict,
  from_provider_product_id text not null,
  from_provider_variant_id text not null,
  target_provider_product_id text not null,
  target_provider_variant_id text not null,
  baseline_period_end timestamptz not null,
  baseline_provider_updated_at timestamptz not null,
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null,
  status text not null default 'requested',
  attempt_count integer not null default 0,
  last_attempt_outcome text,
  last_attempt_at timestamptz,
  confirmed_provider_updated_at timestamptz,
  confirmed_source text,
  confirmed_at timestamptz,
  target_observed_at timestamptz,
  latest_from_observed_at timestamptz,
  observed_provider_updated_at timestamptz,
  observed_status text,
  observed_product_id text,
  observed_variant_id text,
  observed_period_end timestamptz,
  observed_source text,
  renewal_invoice_id text,
  completed_period_end timestamptz,
  completed_at timestamptz,
  conflict_code text,
  resolved_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint billing_plan_changes_provider_check check (provider = 'lemonsqueezy'),
  constraint billing_plan_changes_environment_check check (environment in ('test', 'live')),
  constraint billing_plan_changes_direction_check check (direction in ('upgrade', 'downgrade')),
  constraint billing_plan_changes_plans_distinct_check check (from_plan_id <> target_plan_id),
  constraint billing_plan_changes_status_check check (status in (
    'requested', 'unknown', 'confirmed', 'manual_review', 'completed', 'not_applied', 'abandoned')),
  constraint billing_plan_changes_attempt_check check (attempt_count between 0 and 1),
  constraint billing_plan_changes_attempt_outcome_check
    check (last_attempt_outcome is null or last_attempt_outcome in ('accepted', 'rejected', 'ambiguous')),
  constraint billing_plan_changes_baseline_order_check
    check (baseline_provider_updated_at < baseline_period_end),
  constraint billing_plan_changes_confirmed_check
    check (status not in ('confirmed', 'completed') or confirmed_provider_updated_at is not null),
  constraint billing_plan_changes_completed_check
    check (status <> 'completed' or (renewal_invoice_id is not null and completed_period_end is not null
      and completed_period_end > baseline_period_end)),
  constraint billing_plan_changes_conflict_check
    check (status <> 'manual_review' or conflict_code is not null),
  constraint billing_plan_changes_ids_check check (
    provider_subscription_id ~ '[^[:space:]]' and provider_customer_id ~ '[^[:space:]]'
    and provider_store_id ~ '[^[:space:]]' and from_provider_variant_id ~ '[^[:space:]]'
    and target_provider_variant_id ~ '[^[:space:]]')
);

-- One unresolved change per subscription; manual_review stays blocking until explicitly resolved.
create unique index billing_plan_changes_one_blocking_idx
  on public.billing_subscription_plan_changes(subscription_id)
  where status in ('requested', 'unknown', 'confirmed', 'manual_review');
-- One renewal invoice completes at most one change.
create unique index billing_plan_changes_invoice_unique_idx
  on public.billing_subscription_plan_changes(provider, environment, renewal_invoice_id)
  where renewal_invoice_id is not null;
create index billing_plan_changes_salon_idx
  on public.billing_subscription_plan_changes(salon_id, created_at);

alter table public.billing_subscription_plan_changes owner to postgres;
alter table public.billing_subscription_plan_changes enable row level security;
revoke all on table public.billing_subscription_plan_changes from public, anon, authenticated, service_role;
grant select on table public.billing_subscription_plan_changes to service_role;

create function private.billing_plan_change_row_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_IMMUTABLE';
  end if;
  if old.status in ('completed', 'not_applied', 'abandoned') then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_TERMINAL';
  end if;
  if (new.subscription_id, new.salon_id, new.provider, new.environment, new.provider_subscription_id,
      new.provider_customer_id, new.provider_store_id, new.direction, new.from_plan_id, new.target_plan_id,
      new.from_provider_product_id, new.from_provider_variant_id, new.target_provider_product_id,
      new.target_provider_variant_id, new.baseline_period_end, new.baseline_provider_updated_at,
      new.requested_by_profile_id, new.requested_at, new.created_at)
     is distinct from
     (old.subscription_id, old.salon_id, old.provider, old.environment, old.provider_subscription_id,
      old.provider_customer_id, old.provider_store_id, old.direction, old.from_plan_id, old.target_plan_id,
      old.from_provider_product_id, old.from_provider_variant_id, old.target_provider_product_id,
      old.target_provider_variant_id, old.baseline_period_end, old.baseline_provider_updated_at,
      old.requested_by_profile_id, old.requested_at, old.created_at) then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_IDENTITY_IMMUTABLE';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'requested' and new.status in ('unknown', 'confirmed', 'manual_review', 'not_applied', 'abandoned'))
    or (old.status = 'unknown' and new.status in ('confirmed', 'manual_review', 'abandoned'))
    or (old.status = 'confirmed' and new.status in ('manual_review', 'completed', 'abandoned'))
  ) then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_TRANSITION_INVALID';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger billing_plan_changes_row_guard
before update or delete on public.billing_subscription_plan_changes
for each row execute function private.billing_plan_change_row_guard_v1();

-- Paid-access guard: while a change is blocking, no writer may move plan_id or extend the access
-- period past the baseline. The evaluator terminalises the change row first, then lifts the cap.
create function public.guard_subscription_plan_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change record;
begin
  select c.id, c.baseline_period_end into v_change
  from public.billing_subscription_plan_changes c
  where c.subscription_id = new.id
    and c.status in ('requested', 'unknown', 'confirmed', 'manual_review');
  if v_change.id is not null then
    if new.plan_id is distinct from old.plan_id then
      raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_GUARD_PLAN_LOCKED';
    end if;
    if new.current_period_ends_at is distinct from old.current_period_ends_at
       and (new.current_period_ends_at is null or new.current_period_ends_at > v_change.baseline_period_end) then
      raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_GUARD_PERIOD_CAPPED';
    end if;
  end if;
  return new;
end;
$$;

alter function public.guard_subscription_plan_change_v1() owner to postgres;
revoke all on function public.guard_subscription_plan_change_v1() from public, anon, authenticated, service_role;

create trigger subscriptions_plan_change_guard
before update of plan_id, current_period_ends_at on public.subscriptions
for each row execute function public.guard_subscription_plan_change_v1();

-- ---------------------------------------------------------------------------
-- Review tokens cover the blocking plan-change state (D snapshot and event reprocess tokens).
-- ---------------------------------------------------------------------------

create or replace function private.billing_subscription_state_fingerprint_v1(p_subscription public.subscriptions)
returns text
language sql
stable
set search_path = ''
as $$
  select private.billing_sha256_v1(pg_catalog.jsonb_build_object(
    'id', p_subscription.id,
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
-- Shared observation and evaluation (callers hold the subscription row lock)
-- ---------------------------------------------------------------------------

create function private.mark_billing_plan_change_review_v1(p_change_id uuid, p_code text)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.billing_subscription_plan_changes
  set status = 'manual_review', conflict_code = coalesce(conflict_code, p_code)
  where id = p_change_id and status in ('requested', 'unknown', 'confirmed', 'manual_review')
    and (status <> 'manual_review' or conflict_code is null);
$$;

-- Records one validated provider observation. Never terminalises a change and never touches
-- the subscription. p_lifecycle_applied marks observations that the subscription row now reflects
-- (webhook processor / snapshot apply); provider HTTP results only contribute confirmation facts.
create function private.observe_billing_plan_change_v1(
  p_change_id uuid,
  p_source text,
  p_store text,
  p_product text,
  p_variant text,
  p_status text,
  p_renews_at timestamptz,
  p_ends_at timestamptz,
  p_updated_at timestamptz,
  p_lifecycle_applied boolean,
  p_now timestamptz
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_change public.billing_subscription_plan_changes%rowtype;
  v_kind text;
  v_period_end timestamptz;
begin
  select * into v_change from public.billing_subscription_plan_changes
  where id = p_change_id for update;
  if not found or v_change.status not in ('requested', 'unknown', 'confirmed', 'manual_review') then
    return 'not_pending';
  end if;
  if p_updated_at is null then
    return 'ignored';
  end if;

  if p_store is distinct from v_change.provider_store_id then
    perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_store_conflict');
    return 'conflict';
  end if;
  v_kind := case
    when p_product is not distinct from v_change.target_provider_product_id
         and p_variant is not distinct from v_change.target_provider_variant_id then 'target'
    when p_product is not distinct from v_change.from_provider_product_id
         and p_variant is not distinct from v_change.from_provider_variant_id then 'from'
    else 'unexpected' end;
  if v_kind = 'unexpected' then
    perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_variant_unexpected');
    return 'conflict';
  end if;

  if p_updated_at <= v_change.baseline_provider_updated_at then
    if v_kind = 'target' then
      perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_evidence_order_conflict');
      return 'conflict';
    end if;
    return 'pre_request';
  end if;

  v_period_end := case when p_status in ('cancelled', 'expired') then p_ends_at else p_renews_at end;

  if v_kind = 'target' then
    -- E1: target variant with the provider period still at the baseline, at a provider version
    -- that is itself before the boundary.
    if p_status in ('active', 'cancelled')
       and v_period_end = v_change.baseline_period_end
       and p_updated_at < v_change.baseline_period_end then
      update public.billing_subscription_plan_changes
      set confirmed_source = case
            when confirmed_provider_updated_at is null or p_updated_at > confirmed_provider_updated_at
            then p_source else confirmed_source end,
          confirmed_provider_updated_at = greatest(coalesce(confirmed_provider_updated_at, p_updated_at), p_updated_at),
          confirmed_at = coalesce(confirmed_at, p_now),
          status = case when status in ('requested', 'unknown') then 'confirmed' else status end
      where id = v_change.id;
    end if;
    update public.billing_subscription_plan_changes
    set target_observed_at = greatest(coalesce(target_observed_at, p_updated_at), p_updated_at)
    where id = v_change.id;
  else
    update public.billing_subscription_plan_changes
    set latest_from_observed_at = greatest(coalesce(latest_from_observed_at, p_updated_at), p_updated_at)
    where id = v_change.id;
    if p_status in ('active', 'cancelled') and v_period_end > v_change.baseline_period_end then
      perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_renewed_on_previous_plan');
    end if;
  end if;

  if p_lifecycle_applied then
    update public.billing_subscription_plan_changes
    set observed_provider_updated_at = p_updated_at, observed_status = p_status,
        observed_product_id = p_product, observed_variant_id = p_variant,
        observed_period_end = v_period_end, observed_source = p_source
    where id = v_change.id
      and (observed_provider_updated_at is null or p_updated_at > observed_provider_updated_at);
  end if;
  return v_kind;
end;
$$;

-- The only path that completes a change. Idempotent; safe to call from any lifecycle writer.
create function private.evaluate_billing_plan_change_v1(p_subscription_id uuid, p_now timestamptz)
returns table(outcome text, error_code text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_change public.billing_subscription_plan_changes%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_invoice_id text;
begin
  select * into v_subscription from public.subscriptions where id = p_subscription_id;
  select * into v_change from public.billing_subscription_plan_changes
  where subscription_id = p_subscription_id
    and status in ('requested', 'unknown', 'confirmed', 'manual_review')
  for update;
  if not found then
    return query select 'no_pending'::text, null::text;
    return;
  end if;
  if v_change.status = 'manual_review' then
    return query select 'manual_review'::text, v_change.conflict_code;
    return;
  end if;
  if v_subscription.status = 'expired' then
    update public.billing_subscription_plan_changes
    set status = 'abandoned', resolved_at = p_now where id = v_change.id;
    return query select 'abandoned'::text, null::text;
    return;
  end if;
  if v_change.status in ('requested', 'unknown') then
    return query select 'awaiting_confirmation'::text, null::text;
    return;
  end if;

  -- confirmed (E1)
  if v_change.latest_from_observed_at is not null
     and v_change.latest_from_observed_at > v_change.confirmed_provider_updated_at then
    perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_variant_reverted');
    return query select 'manual_review'::text, 'plan_change_variant_reverted'::text;
    return;
  end if;

  -- E2: the newest applied lifecycle state shows the target with a renewed period.
  if v_change.observed_provider_updated_at is null
     or v_change.observed_provider_updated_at <= v_change.confirmed_provider_updated_at
     or v_change.observed_provider_updated_at is distinct from v_subscription.provider_state_updated_at
     or v_change.observed_product_id is distinct from v_change.target_provider_product_id
     or v_change.observed_variant_id is distinct from v_change.target_provider_variant_id
     or v_change.observed_status not in ('active', 'cancelled')
     or v_subscription.status not in ('active', 'cancelled')
     or v_change.observed_period_end is null
     or v_change.observed_period_end <= v_change.baseline_period_end then
    return query select 'awaiting_renewal'::text, null::text;
    return;
  end if;
  -- Sanity bound for one monthly renewal (month-end anchors may add a few days); not a calendar.
  if v_change.observed_period_end > v_change.baseline_period_end + interval '1 month' + interval '4 days' then
    perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_renewal_period_unexpected');
    return query select 'manual_review'::text, 'plan_change_renewal_period_unexpected'::text;
    return;
  end if;

  -- E3: durable paid renewal invoice of the same provider subscription, created at/after the
  -- boundary, after the confirmation and inside the renewed period, not used by another change.
  select i.provider_invoice_id into v_invoice_id
  from public.billing_webhook_subscription_invoice_facts i
  where i.provider = v_change.provider and i.environment = v_change.environment
    and i.provider_subscription_id = v_change.provider_subscription_id
    and i.provider_customer_id = v_change.provider_customer_id
    and i.provider_store_id = v_change.provider_store_id
    and i.billing_reason = 'renewal' and i.invoice_status = 'paid'
    and i.provider_invoice_created_at >= v_change.baseline_period_end
    and i.provider_invoice_created_at > v_change.confirmed_provider_updated_at
    and i.provider_invoice_created_at < v_change.observed_period_end
    and not exists (
      select 1 from public.billing_subscription_plan_changes o
      where o.provider = i.provider and o.environment = i.environment
        and o.renewal_invoice_id = i.provider_invoice_id)
  order by i.provider_invoice_created_at, i.provider_invoice_id
  limit 1;
  if v_invoice_id is null then
    return query select 'awaiting_payment'::text, null::text;
    return;
  end if;

  update public.billing_subscription_plan_changes
  set status = 'completed', renewal_invoice_id = v_invoice_id, completed_at = p_now,
      completed_period_end = v_change.observed_period_end, resolved_at = p_now
  where id = v_change.id;
  update public.subscriptions
  set plan_id = v_change.target_plan_id,
      current_period_ends_at = v_change.observed_period_end,
      updated_at = p_now
  where id = v_subscription.id;
  return query select 'completed'::text, null::text;
end;
$$;

revoke all on function private.billing_plan_change_row_guard_v1() from public, anon, authenticated, service_role;
revoke all on function private.mark_billing_plan_change_review_v1(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.observe_billing_plan_change_v1(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.evaluate_billing_plan_change_v1(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Request eligibility (shared by prepare and request)
-- ---------------------------------------------------------------------------

create function private.billing_plan_change_eligibility_v1(
  p_subscription public.subscriptions,
  p_actor_profile_id uuid,
  p_target_plan_id uuid,
  p_now timestamptz
)
returns table(
  error_code text,
  direction text,
  from_store_id text,
  from_product_id text,
  from_variant_id text,
  target_product_id text,
  target_variant_id text,
  target_max_employees integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_runtime_count integer;
  v_runtime_env text;
  v_from public.plans%rowtype;
  v_target public.plans%rowtype;
  v_from_map public.billing_provider_prices%rowtype;
  v_target_map public.billing_provider_prices%rowtype;
  v_count integer;
begin
  select pg_catalog.count(*), pg_catalog.min(c.environment) into v_runtime_count, v_runtime_env
  from private.billing_runtime_config c;
  if v_runtime_count <> 1 or v_runtime_env not in ('test', 'live')
     or p_subscription.billing_environment is distinct from v_runtime_env then
    return query select 'BILLING_PLAN_CHANGE_ENVIRONMENT_MISMATCH'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if p_subscription.billing_provider is distinct from 'lemonsqueezy'
     or p_subscription.provider_customer_id is null or not (p_subscription.provider_customer_id ~ '[^[:space:]]')
     or p_subscription.provider_subscription_id is null or not (p_subscription.provider_subscription_id ~ '[^[:space:]]') then
    return query select 'BILLING_PLAN_CHANGE_SUBSCRIPTION_UNSUPPORTED'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if not exists (select 1 from public.salons s where s.id = p_subscription.salon_id and s.owner_id = p_actor_profile_id)
     and not exists (select 1 from public.salon_members m
                     where m.salon_id = p_subscription.salon_id and m.profile_id = p_actor_profile_id
                       and m.role = 'owner' and m.status = 'active') then
    return query select 'BILLING_PLAN_CHANGE_FORBIDDEN'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if exists (select 1 from public.billing_access_overrides o
             where o.salon_id = p_subscription.salon_id and o.enabled = true
               and o.starts_at <= p_now and (o.ends_at is null or o.ends_at > p_now)) then
    return query select 'BILLING_PLAN_CHANGE_OVERRIDE_ACTIVE'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if p_subscription.status = 'past_due' then
    return query select 'BILLING_SUBSCRIPTION_PAYMENT_REQUIRED'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if p_subscription.status = 'cancelled' or p_subscription.cancel_at_period_end then
    return query select 'BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if p_subscription.status <> 'active' or p_subscription.current_period_ends_at is null
     or p_subscription.current_period_starts_at is null
     or (p_subscription.trial_ends_at is not null and p_subscription.trial_ends_at > p_now) then
    return query select 'BILLING_PLAN_CHANGE_SUBSCRIPTION_UNSUPPORTED'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if p_subscription.current_period_ends_at - p_now <= interval '48 hours' then
    return query select 'BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if exists (select 1 from public.billing_subscription_plan_changes c
             where c.subscription_id = p_subscription.id
               and c.status in ('requested', 'unknown', 'confirmed', 'manual_review')) then
    return query select 'BILLING_PLAN_CHANGE_PENDING'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  if exists (select 1 from public.billing_checkout_sessions c
             where c.salon_id = p_subscription.salon_id and c.status in ('creating', 'open'))
     or exists (select 1 from public.resolve_billing_purchase_activation_v1(p_subscription.salon_id)) then
    return query select 'BILLING_PURCHASE_ACTIVATION_PENDING'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;

  select * into v_from from public.plans where id = p_subscription.plan_id;
  select * into v_target from public.plans where id = p_target_plan_id;
  if v_from.id is null or v_from.slug not in ('starter', 'pro')
     or v_target.id is null or v_target.slug not in ('starter', 'pro')
     or v_target.is_active is distinct from true or v_target.id = v_from.id then
    return query select 'BILLING_PLAN_CHANGE_TARGET_INVALID'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;

  select pg_catalog.count(*) into v_count from public.billing_provider_prices m
  where m.provider = 'lemonsqueezy' and m.environment = v_runtime_env
    and m.plan_id = v_from.id and m.billing_interval = 'monthly';
  select * into v_from_map from public.billing_provider_prices m
  where m.provider = 'lemonsqueezy' and m.environment = v_runtime_env
    and m.plan_id = v_from.id and m.billing_interval = 'monthly';
  if v_count <> 1 or v_from_map.provider_store_id is null or v_from_map.provider_product_id is null then
    return query select 'BILLING_PLAN_CHANGE_MAPPING_INVALID'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;
  select pg_catalog.count(*) into v_count from public.billing_provider_prices m
  where m.provider = 'lemonsqueezy' and m.environment = v_runtime_env
    and m.plan_id = v_target.id and m.billing_interval = 'monthly' and m.is_active;
  select * into v_target_map from public.billing_provider_prices m
  where m.provider = 'lemonsqueezy' and m.environment = v_runtime_env
    and m.plan_id = v_target.id and m.billing_interval = 'monthly' and m.is_active;
  if v_count <> 1 or v_target_map.provider_product_id is null
     or v_target_map.provider_store_id is distinct from v_from_map.provider_store_id
     or v_target_map.currency is distinct from v_from_map.currency then
    return query select 'BILLING_PLAN_CHANGE_MAPPING_INVALID'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::integer;
    return;
  end if;

  return query select null::text,
    case when v_target.slug = 'pro' then 'upgrade' else 'downgrade' end,
    v_from_map.provider_store_id, v_from_map.provider_product_id, v_from_map.provider_variant_id,
    v_target_map.provider_product_id, v_target_map.provider_variant_id, v_target.max_employees;
end;
$$;

revoke all on function private.billing_plan_change_eligibility_v1(public.subscriptions, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- Read-only: what a server adapter needs before its provider GET.
create function public.prepare_billing_plan_change_v1(
  p_salon_id uuid,
  p_actor_profile_id uuid,
  p_target_plan_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table(
  outcome text,
  error_code text,
  subscription_id uuid,
  provider_subscription_id text,
  baseline_period_end timestamptz,
  direction text,
  target_provider_variant_id text,
  state_token text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_count integer;
  v_eligibility record;
begin
  if p_salon_id is null or p_actor_profile_id is null or p_target_plan_id is null or p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_PLAN_CHANGE_ARGUMENT_REQUIRED';
  end if;
  select pg_catalog.count(*) into v_count from public.subscriptions s where s.salon_id = p_salon_id;
  if v_count <> 1 then
    return query select 'rejected'::text, 'BILLING_PLAN_CHANGE_SUBSCRIPTION_UNSUPPORTED'::text,
      null::uuid, null::text, null::timestamptz, null::text, null::text, null::text;
    return;
  end if;
  select * into v_subscription from public.subscriptions s where s.salon_id = p_salon_id;
  select * into v_eligibility from private.billing_plan_change_eligibility_v1(
    v_subscription, p_actor_profile_id, p_target_plan_id, p_now);
  if v_eligibility.error_code is null and v_eligibility.direction = 'downgrade'
     and v_eligibility.target_max_employees is not null
     and (select pg_catalog.count(*) from public.employees e
          where e.salon_id = p_salon_id and e.is_active) > v_eligibility.target_max_employees then
    v_eligibility.error_code := 'EMPLOYEE_OVER_TARGET_LIMIT';
  end if;
  if v_eligibility.error_code is not null then
    return query select 'rejected'::text, v_eligibility.error_code, v_subscription.id,
      null::text, null::timestamptz, null::text, null::text, null::text;
    return;
  end if;
  return query select 'eligible'::text, null::text, v_subscription.id,
    v_subscription.provider_subscription_id, v_subscription.current_period_ends_at,
    v_eligibility.direction, v_eligibility.target_variant_id,
    private.billing_subscription_state_fingerprint_v1(v_subscription);
end;
$$;

-- Atomic acquisition of one plan-change intent, after the adapter's fresh provider GET and before
-- its PATCH. Raises a stable error code on every rejection.
create function public.request_billing_plan_change_v1(
  p_salon_id uuid,
  p_actor_profile_id uuid,
  p_target_plan_id uuid,
  p_state_token text,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_store_id text,
  p_test_mode boolean,
  p_provider_product_id text,
  p_provider_variant_id text,
  p_provider_status text,
  p_provider_cancelled boolean,
  p_provider_pause_mode text,
  p_provider_trial_ends_at timestamptz,
  p_provider_renews_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_updated_at timestamptz,
  p_provider_checked_at timestamptz,
  p_now timestamptz default pg_catalog.now()
)
returns table(
  outcome text,
  plan_change_id uuid,
  direction text,
  target_provider_variant_id text,
  baseline_period_end timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_count integer;
  v_eligibility record;
  v_active integer;
  v_change_id uuid;
begin
  if p_salon_id is null or p_actor_profile_id is null or p_target_plan_id is null or p_now is null
     or p_state_token is null or p_provider_updated_at is null or p_provider_checked_at is null then
    raise exception using errcode = '22004', message = 'BILLING_PLAN_CHANGE_ARGUMENT_REQUIRED';
  end if;

  select pg_catalog.count(*) into v_count from public.subscriptions s where s.salon_id = p_salon_id;
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_SUBSCRIPTION_UNSUPPORTED';
  end if;
  select * into v_subscription from public.subscriptions s where s.salon_id = p_salon_id for update;
  perform 1 from public.plans p where p.id in (v_subscription.plan_id, p_target_plan_id) for share;

  select * into v_eligibility from private.billing_plan_change_eligibility_v1(
    v_subscription, p_actor_profile_id, p_target_plan_id, p_now);
  if v_eligibility.error_code is not null then
    raise exception using errcode = 'P0001', message = v_eligibility.error_code;
  end if;
  -- Local version re-check after the external read.
  if private.billing_subscription_state_fingerprint_v1(v_subscription) is distinct from p_state_token then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_STATE_CHANGED';
  end if;
  if p_provider_checked_at > p_now or p_provider_checked_at < p_now - interval '10 minutes'
     or p_provider_updated_at > p_provider_checked_at then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_PROVIDER_EVIDENCE_STALE';
  end if;
  -- The fresh provider read must show exactly the local paid period on the from-plan.
  if p_provider_subscription_id is distinct from v_subscription.provider_subscription_id
     or p_provider_customer_id is distinct from v_subscription.provider_customer_id
     or p_provider_store_id is distinct from v_eligibility.from_store_id
     or p_test_mode is distinct from (v_subscription.billing_environment = 'test')
     or p_provider_product_id is distinct from v_eligibility.from_product_id
     or p_provider_variant_id is distinct from v_eligibility.from_variant_id
     or p_provider_status is distinct from 'active'
     or p_provider_cancelled is distinct from false
     or p_provider_pause_mode is not null
     or p_provider_trial_ends_at is not null
     or p_provider_ends_at is not null
     or p_provider_renews_at is distinct from v_subscription.current_period_ends_at
     or (v_subscription.provider_state_updated_at is not null
         and p_provider_updated_at < v_subscription.provider_state_updated_at)
     or p_provider_updated_at >= v_subscription.current_period_ends_at then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_PROVIDER_STATE_MISMATCH';
  end if;

  -- Employee-capacity lock last, as in checkout acquisition; the trigger sees this row afterwards.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rezervo:employee-capacity:' || p_salon_id::text, 0));
  select pg_catalog.count(*) into v_active
  from public.employees e where e.salon_id = p_salon_id and e.is_active = true;
  if v_eligibility.direction = 'downgrade' and v_eligibility.target_max_employees is not null
     and v_active > v_eligibility.target_max_employees then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_OVER_TARGET_LIMIT';
  end if;

  insert into public.billing_subscription_plan_changes(
    subscription_id, salon_id, provider, environment, provider_subscription_id, provider_customer_id,
    provider_store_id, direction, from_plan_id, target_plan_id, from_provider_product_id,
    from_provider_variant_id, target_provider_product_id, target_provider_variant_id,
    baseline_period_end, baseline_provider_updated_at, requested_by_profile_id, requested_at, status
  ) values (
    v_subscription.id, v_subscription.salon_id, 'lemonsqueezy', v_subscription.billing_environment,
    v_subscription.provider_subscription_id, v_subscription.provider_customer_id,
    v_eligibility.from_store_id, v_eligibility.direction, v_subscription.plan_id, p_target_plan_id,
    v_eligibility.from_product_id, v_eligibility.from_variant_id, v_eligibility.target_product_id,
    v_eligibility.target_variant_id, v_subscription.current_period_ends_at, p_provider_updated_at,
    p_actor_profile_id, p_now, 'requested'
  ) returning id into v_change_id;

  return query select 'requested'::text, v_change_id, v_eligibility.direction,
    v_eligibility.target_variant_id, v_subscription.current_period_ends_at;
end;
$$;

-- Records the outcome of the adapter's single PATCH ('accepted' / 'rejected' / 'ambiguous') or a
-- later validated provider read ('observed'). 'rejected' is only for an explicitly recognised
-- provider response proving the change was not applied; not every 4xx qualifies. 429, timeout,
-- transport failure and any unclear response are 'ambiguous' (never not_applied). An HTTP 200 is
-- neither a payment nor a completion: 'accepted' only contributes confirmation evidence.
create function public.record_billing_plan_change_provider_result_v1(
  p_environment text,
  p_plan_change_id uuid,
  p_result text,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_store_id text,
  p_test_mode boolean,
  p_provider_product_id text,
  p_provider_variant_id text,
  p_provider_status text,
  p_provider_cancelled boolean,
  p_provider_pause_mode text,
  p_provider_trial_ends_at timestamptz,
  p_provider_renews_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_updated_at timestamptz,
  p_now timestamptz default pg_catalog.now()
)
returns table(outcome text, plan_change_status text, error_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subscription_id uuid;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_kind text;
  v_eval record;
begin
  if p_now is null or p_plan_change_id is null then
    raise exception using errcode = '22004', message = 'BILLING_PLAN_CHANGE_ARGUMENT_REQUIRED';
  end if;
  if p_result is null or p_result not in ('accepted', 'rejected', 'ambiguous', 'observed') then
    raise exception using errcode = '22023', message = 'BILLING_PLAN_CHANGE_RESULT_INVALID';
  end if;
  if p_environment is null or p_environment not in ('test', 'live')
     or not public.billing_environment_matches_v1(p_environment) then
    return query select 'environment_mismatch'::text, null::text, 'plan_change_environment_mismatch'::text;
    return;
  end if;

  select c.subscription_id into v_subscription_id
  from public.billing_subscription_plan_changes c where c.id = p_plan_change_id;
  if v_subscription_id is null then
    return query select 'not_found'::text, null::text, 'plan_change_not_found'::text;
    return;
  end if;
  perform 1 from public.subscriptions s where s.id = v_subscription_id for update;
  select * into v_change from public.billing_subscription_plan_changes
  where id = p_plan_change_id for update;
  if v_change.environment is distinct from p_environment then
    return query select 'not_found'::text, null::text, 'plan_change_not_found'::text;
    return;
  end if;
  if v_change.status not in ('requested', 'unknown', 'confirmed', 'manual_review') then
    return query select 'not_pending'::text, v_change.status, null::text;
    return;
  end if;

  if p_result in ('accepted', 'rejected', 'ambiguous') then
    -- Exactly one provider PATCH attempt per change in this phase (no automatic repeat). Recording
    -- the same result again (adapter retry after a lost DB response) is an idempotent replay; a
    -- different second result is refused.
    if v_change.attempt_count >= 1 then
      if v_change.last_attempt_outcome is distinct from p_result then
        raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_ATTEMPT_ALREADY_RECORDED';
      end if;
    else
      update public.billing_subscription_plan_changes
      set attempt_count = attempt_count + 1, last_attempt_outcome = p_result, last_attempt_at = p_now
      where id = v_change.id;
    end if;
  end if;

  if p_result = 'ambiguous' then
    update public.billing_subscription_plan_changes
    set status = 'unknown' where id = v_change.id and status = 'requested';
  elsif p_result = 'rejected' then
    -- Definitive provider validation rejection. Only an untouched request becomes not_applied.
    if v_change.status = 'requested' and v_change.target_observed_at is null then
      update public.billing_subscription_plan_changes
      set status = 'not_applied', resolved_at = p_now where id = v_change.id;
    else
      perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_rejection_conflict');
    end if;
  else
    if p_provider_subscription_id is distinct from v_change.provider_subscription_id
       or p_provider_customer_id is distinct from v_change.provider_customer_id
       or p_test_mode is distinct from (v_change.environment = 'test')
       or p_provider_updated_at is null then
      perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_provider_identity_conflict');
    elsif p_provider_pause_mode is not null or p_provider_trial_ends_at is not null
       or p_provider_status is null
       or p_provider_status not in ('active', 'cancelled', 'past_due', 'unpaid', 'expired') then
      perform private.mark_billing_plan_change_review_v1(v_change.id, 'plan_change_provider_state_unsupported');
    else
      v_kind := private.observe_billing_plan_change_v1(
        v_change.id, case p_result when 'accepted' then 'provider_patch' else 'provider_read' end,
        p_provider_store_id, p_provider_product_id, p_provider_variant_id, p_provider_status,
        p_provider_renews_at, p_provider_ends_at, p_provider_updated_at, false, p_now);
      if p_result = 'accepted' and v_kind is distinct from 'target' then
        -- Accepted HTTP response that does not show the target (previous variant, or a provider
        -- version not newer than the pre-request read): the outcome is not known.
        update public.billing_subscription_plan_changes
        set status = 'unknown' where id = v_change.id and status = 'requested';
      end if;
    end if;
  end if;

  select * into v_eval from private.evaluate_billing_plan_change_v1(v_subscription_id, p_now);
  select * into v_change from public.billing_subscription_plan_changes where id = p_plan_change_id;
  return query select v_eval.outcome, v_change.status, coalesce(v_eval.error_code, v_change.conflict_code);
end;
$$;

-- Idempotent re-evaluation entry point (status check / operator), with no new provider evidence.
create function public.evaluate_billing_plan_change_v1(
  p_environment text,
  p_subscription_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table(outcome text, plan_change_status text, error_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_eval record;
  v_status text;
begin
  if p_now is null or p_subscription_id is null then
    raise exception using errcode = '22004', message = 'BILLING_PLAN_CHANGE_ARGUMENT_REQUIRED';
  end if;
  if p_environment is null or p_environment not in ('test', 'live')
     or not public.billing_environment_matches_v1(p_environment) then
    return query select 'environment_mismatch'::text, null::text, 'plan_change_environment_mismatch'::text;
    return;
  end if;
  perform 1 from public.subscriptions s
  where s.id = p_subscription_id and s.billing_environment = p_environment for update;
  if not found then
    return query select 'not_found'::text, null::text, 'plan_change_subscription_not_found'::text;
    return;
  end if;
  select * into v_eval from private.evaluate_billing_plan_change_v1(p_subscription_id, p_now);
  select c.status into v_status from public.billing_subscription_plan_changes c
  where c.subscription_id = p_subscription_id order by c.created_at desc, c.id limit 1;
  return query select v_eval.outcome, v_status, v_eval.error_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Updated processor: transition-aware (same signature; every caller goes through it)
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
  'Processes a verified Lemon Squeezy subscription_updated event in the environment owned by the locked event row. With an unresolved plan change the recorded target variant is expected, the paid access period is capped at the immutable baseline and only the shared plan-change evaluator may complete the change.';

-- ---------------------------------------------------------------------------
-- Invoice evidence ingest: unchanged recording, then the shared evaluator.
-- ---------------------------------------------------------------------------

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
  v_subscription_id uuid;
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

  -- C2: a durable paid renewal may complete an unresolved plan change. The subscription lock is
  -- taken after the evidence row, so a concurrent updated processor either already committed its
  -- observation (seen here) or waits and then sees this invoice in its own evaluation.
  if p_billing_reason = 'renewal' then
    select s.id into v_subscription_id
    from public.subscriptions s
    where s.billing_provider = 'lemonsqueezy' and s.billing_environment = p_environment
      and s.provider_subscription_id = p_provider_subscription_id
    for update;
    if v_subscription_id is not null then
      perform private.evaluate_billing_plan_change_v1(v_subscription_id, p_now);
    end if;
  end if;

  return query select v_event_id, 'invoice_evidence_recorded'::text, 'processed'::text;
end;
$$;

comment on function public.ingest_billing_subscription_invoice_evidence_v1(
  text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz
) is
  'Atomically records a terminal payment-success webhook event and canonical invoice evidence. A newly recorded paid renewal then runs the shared plan-change evaluator for its subscription; nothing else reads or mutates subscriptions.';

-- ---------------------------------------------------------------------------
-- D snapshot recovery: same transition rules as the updated processor.
-- ---------------------------------------------------------------------------

create or replace function private.evaluate_billing_snapshot_recovery_v1(
  p_environment text,
  p_subscription public.subscriptions,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_store_id text,
  p_test_mode boolean,
  p_provider_product_id text,
  p_provider_variant_id text,
  p_provider_status text,
  p_provider_cancelled boolean,
  p_provider_pause_mode text,
  p_provider_pause_resumes_at timestamptz,
  p_provider_trial_ends_at timestamptz,
  p_provider_renews_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_created_at timestamptz,
  p_provider_updated_at timestamptz,
  p_now timestamptz
)
returns table(
  verdict text,
  error_code text,
  proposed_status text,
  proposed_period_ends_at timestamptz,
  proposed_cancel_at_period_end boolean,
  proposed_cancelled_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_mapping_count integer;
  v_expected_target boolean := false;
  v_status public.subscription_status;
  v_period_end timestamptz;
  v_cancel boolean;
  v_cancelled_at timestamptz;
  v_error text;
begin
  if p_subscription.billing_provider is distinct from 'lemonsqueezy'
     or p_subscription.billing_environment is distinct from p_environment
     or p_subscription.provider_subscription_id is distinct from p_provider_subscription_id
     or p_provider_customer_id is null
     or not (p_provider_customer_id ~ '[^[:space:]]')
     or p_subscription.provider_customer_id is distinct from p_provider_customer_id
     or p_test_mode is distinct from (p_environment = 'test') then
    return query select 'identity_conflict'::text, 'recovery_identity_conflict'::text,
      null::text, null::timestamptz, null::boolean, null::timestamptz;
    return;
  end if;

  select * into v_plan from public.plans where id = p_subscription.plan_id;
  if v_plan.id is null or v_plan.slug not in ('starter', 'pro') then
    return query select 'mapping_conflict'::text, 'recovery_plan_invalid'::text,
      null::text, null::timestamptz, null::boolean, null::timestamptz;
    return;
  end if;
  if p_provider_store_id is null or not (p_provider_store_id ~ '[^[:space:]]')
     or p_provider_product_id is null or not (p_provider_product_id ~ '[^[:space:]]')
     or p_provider_variant_id is null or not (p_provider_variant_id ~ '[^[:space:]]') then
    return query select 'mapping_conflict'::text, 'recovery_mapping_invalid'::text,
      null::text, null::timestamptz, null::boolean, null::timestamptz;
    return;
  end if;

  select * into v_change from public.billing_subscription_plan_changes c
  where c.subscription_id = p_subscription.id
    and c.status in ('requested', 'unknown', 'confirmed', 'manual_review');
  v_expected_target := v_change.id is not null
    and p_provider_store_id is not distinct from v_change.provider_store_id
    and p_provider_product_id is not distinct from v_change.target_provider_product_id
    and p_provider_variant_id is not distinct from v_change.target_provider_variant_id;

  select pg_catalog.count(*) into v_mapping_count
  from public.billing_provider_prices m
  where m.provider = 'lemonsqueezy'
    and m.environment = p_environment
    and m.plan_id = p_subscription.plan_id
    and m.billing_interval = 'monthly'
    and m.provider_store_id = p_provider_store_id
    and m.provider_product_id = p_provider_product_id
    and m.provider_variant_id = p_provider_variant_id;
  if v_mapping_count <> 1 and not v_expected_target then
    if exists (
      select 1
      from public.billing_provider_prices other_mapping
      join public.plans other_plan on other_plan.id = other_mapping.plan_id
      where other_mapping.provider = 'lemonsqueezy'
        and other_mapping.environment = p_environment
        and other_mapping.billing_interval = 'monthly'
        and other_plan.slug in ('starter', 'pro')
        and other_mapping.plan_id <> p_subscription.plan_id
        and other_mapping.provider_variant_id = p_provider_variant_id
        and other_mapping.provider_product_id is not distinct from p_provider_product_id
    ) then
      return query select 'plan_change_unsupported'::text, 'recovery_plan_change_unsupported'::text,
        null::text, null::timestamptz, null::boolean, null::timestamptz;
    else
      return query select 'mapping_conflict'::text, 'recovery_mapping_invalid'::text,
        null::text, null::timestamptz, null::boolean, null::timestamptz;
    end if;
    return;
  end if;

  if p_provider_created_at is null or p_provider_updated_at is null
     or p_provider_updated_at < p_provider_created_at then
    return query select 'snapshot_invalid'::text, 'recovery_snapshot_timestamps_invalid'::text,
      null::text, null::timestamptz, null::boolean, null::timestamptz;
    return;
  end if;

  if p_subscription.provider_state_updated_at is not null
     and p_provider_updated_at < p_subscription.provider_state_updated_at then
    return query select 'stale_snapshot'::text, 'recovery_snapshot_older_than_local_state'::text,
      null::text, null::timestamptz, null::boolean, null::timestamptz;
    return;
  end if;

  if p_provider_pause_mode is not null or p_provider_pause_resumes_at is not null then
    v_error := 'recovery_pause_unsupported';
  elsif p_provider_status = 'on_trial' or p_provider_trial_ends_at is not null then
    v_error := 'recovery_provider_trial_unsupported';
  elsif p_provider_status = 'active' then
    if p_subscription.status = 'expired' then
      v_error := 'recovery_expired_reactivation_unsupported';
    elsif p_subscription.status not in ('active', 'cancelled', 'past_due')
       or p_provider_cancelled is distinct from false
       or p_provider_ends_at is not null
       or p_provider_renews_at is null
       or p_provider_renews_at <= p_now
       or p_subscription.current_period_starts_at is null
       or p_provider_renews_at <= p_subscription.current_period_starts_at then
      v_error := 'recovery_provider_state_unsupported';
    else
      v_status := 'active';
      v_period_end := p_provider_renews_at;
      v_cancel := false;
      v_cancelled_at := null;
    end if;
  elsif p_provider_status = 'cancelled' then
    if p_provider_cancelled is distinct from true
       or p_provider_ends_at is null
       or p_provider_ends_at <= p_now
       or p_provider_ends_at <= p_provider_updated_at then
      v_error := 'recovery_provider_state_unsupported';
    else
      v_status := 'cancelled';
      v_period_end := p_provider_ends_at;
      v_cancel := true;
      v_cancelled_at := coalesce(p_subscription.cancelled_at, p_provider_updated_at);
    end if;
  elsif p_provider_status in ('past_due', 'unpaid') then
    if p_provider_cancelled is distinct from false or p_provider_ends_at is not null then
      v_error := 'recovery_provider_state_unsupported';
    else
      v_status := 'past_due';
      v_period_end := p_subscription.current_period_ends_at;
      v_cancel := false;
      v_cancelled_at := null;
    end if;
  elsif p_provider_status = 'expired' then
    if p_provider_ends_at is null
       or p_provider_ends_at > p_now
       or p_provider_ends_at > p_provider_updated_at then
      v_error := 'recovery_provider_state_unsupported';
    else
      v_status := 'expired';
      v_period_end := p_provider_ends_at;
      v_cancel := false;
      v_cancelled_at := p_subscription.cancelled_at;
    end if;
  else
    v_error := 'recovery_provider_state_unsupported';
  end if;

  if v_error is not null then
    return query select 'unsupported_state'::text, v_error,
      null::text, null::timestamptz, null::boolean, null::timestamptz;
    return;
  end if;

  -- C2: same paid-access cap as the updated processor; a snapshot never extends access or
  -- assigns the target plan. Completion stays with the shared evaluator (E3 required).
  if v_change.id is not null then
    v_period_end := least(v_period_end, v_change.baseline_period_end);
  end if;

  if p_subscription.provider_state_updated_at = p_provider_updated_at then
    if p_subscription.status = v_status
       and p_subscription.current_period_ends_at is not distinct from v_period_end
       and p_subscription.cancel_at_period_end is not distinct from v_cancel
       and p_subscription.cancelled_at is not distinct from v_cancelled_at then
      return query select 'no_change'::text, null::text,
        v_status::text, v_period_end, v_cancel, v_cancelled_at;
    else
      return query select 'same_timestamp_conflict'::text, 'recovery_same_timestamp_conflict'::text,
        null::text, null::timestamptz, null::boolean, null::timestamptz;
    end if;
    return;
  end if;

  return query select 'eligible'::text, null::text,
    v_status::text, v_period_end, v_cancel, v_cancelled_at;
end;
$$;

create or replace function public.apply_billing_subscription_recovery_v1(
  p_environment text,
  p_subscription_id uuid,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_store_id text,
  p_test_mode boolean,
  p_provider_product_id text,
  p_provider_variant_id text,
  p_provider_status text,
  p_provider_cancelled boolean,
  p_provider_pause_mode text,
  p_provider_pause_resumes_at timestamptz,
  p_provider_trial_ends_at timestamptz,
  p_provider_renews_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_created_at timestamptz,
  p_provider_updated_at timestamptz,
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
  v_subscription public.subscriptions%rowtype;
  v_change_id uuid;
  v_eval record;
  v_change_eval record;
  v_evidence text;
  v_token text;
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

  -- Same lock the webhook processors take, so a concurrent webhook serialises with this apply.
  select * into v_subscription
  from public.subscriptions where id = p_subscription_id for update;
  if not found then
    return query select 'not_found'::text, 'recovery_subscription_not_found'::text, null::uuid;
    return;
  end if;
  -- lock order mirrors process_billing_subscription_updated_v2: subscription, plan, mapping, change
  perform 1 from public.plans where id = v_subscription.plan_id for share;
  perform 1
  from public.billing_provider_prices
  where provider = 'lemonsqueezy' and environment = p_environment
    and plan_id = v_subscription.plan_id and billing_interval = 'monthly'
    and provider_store_id = p_provider_store_id
    and provider_product_id = p_provider_product_id
    and provider_variant_id = p_provider_variant_id
  for share;
  select c.id into v_change_id from public.billing_subscription_plan_changes c
  where c.subscription_id = v_subscription.id
    and c.status in ('requested', 'unknown', 'confirmed', 'manual_review')
  for update;

  v_evidence := private.billing_snapshot_fingerprint_v1(
    p_environment, p_provider_subscription_id, p_provider_customer_id, p_provider_store_id,
    p_test_mode, p_provider_product_id, p_provider_variant_id, p_provider_status,
    p_provider_cancelled, p_provider_pause_mode, p_provider_pause_resumes_at,
    p_provider_trial_ends_at, p_provider_renews_at, p_provider_ends_at,
    p_provider_created_at, p_provider_updated_at);

  select * into v_eval from private.evaluate_billing_snapshot_recovery_v1(
    p_environment, v_subscription, p_provider_subscription_id, p_provider_customer_id,
    p_provider_store_id, p_test_mode, p_provider_product_id, p_provider_variant_id,
    p_provider_status, p_provider_cancelled, p_provider_pause_mode, p_provider_pause_resumes_at,
    p_provider_trial_ends_at, p_provider_renews_at, p_provider_ends_at, p_provider_created_at,
    p_provider_updated_at, p_now);

  v_token := private.billing_sha256_v1(pg_catalog.jsonb_build_object(
    'local', private.billing_subscription_state_fingerprint_v1(v_subscription),
    'evidence', v_evidence,
    'verdict', v_eval.verdict,
    'proposed_status', v_eval.proposed_status,
    'proposed_period_ends_at', private.billing_epoch_v1(v_eval.proposed_period_ends_at),
    'proposed_cancel_at_period_end', v_eval.proposed_cancel_at_period_end,
    'proposed_cancelled_at', private.billing_epoch_v1(v_eval.proposed_cancelled_at)));

  v_prior := pg_catalog.jsonb_build_object(
    'status', v_subscription.status,
    'current_period_ends_at', v_subscription.current_period_ends_at,
    'cancel_at_period_end', v_subscription.cancel_at_period_end,
    'cancelled_at', v_subscription.cancelled_at,
    'provider_state_updated_at', v_subscription.provider_state_updated_at,
    'plan_change_id', v_change_id);

  v_outcome := v_eval.verdict;
  v_error := v_eval.error_code;

  if v_eval.verdict = 'eligible' and v_token is distinct from p_review_token then
    -- local state (including the plan-change state) or provider evidence changed since dry-run
    v_outcome := 'stale';
    v_error := 'recovery_review_token_stale';
  elsif v_eval.verdict = 'eligible' then
    update public.subscriptions
    set status = v_eval.proposed_status::public.subscription_status,
        current_period_ends_at = v_eval.proposed_period_ends_at,
        cancel_at_period_end = v_eval.proposed_cancel_at_period_end,
        cancelled_at = v_eval.proposed_cancelled_at,
        provider_state_updated_at = p_provider_updated_at,
        updated_at = p_now
    where id = v_subscription.id;
    v_outcome := 'applied';
    v_applied := pg_catalog.jsonb_build_object(
      'status', v_eval.proposed_status,
      'current_period_ends_at', v_eval.proposed_period_ends_at,
      'cancel_at_period_end', v_eval.proposed_cancel_at_period_end,
      'cancelled_at', v_eval.proposed_cancelled_at,
      'provider_state_updated_at', p_provider_updated_at);
    if v_change_id is not null then
      perform private.observe_billing_plan_change_v1(
        v_change_id, 'operator_snapshot', p_provider_store_id, p_provider_product_id,
        p_provider_variant_id, p_provider_status, p_provider_renews_at, p_provider_ends_at,
        p_provider_updated_at, true, p_now);
      select * into v_change_eval from private.evaluate_billing_plan_change_v1(v_subscription.id, p_now);
      v_applied := v_applied || pg_catalog.jsonb_build_object(
        'plan_change_outcome', v_change_eval.outcome, 'plan_change_error', v_change_eval.error_code);
    end if;
  elsif v_change_id is not null and v_token is not distinct from p_review_token
        and (v_eval.error_code = 'recovery_plan_change_unsupported'
             or (v_eval.error_code = 'recovery_mapping_invalid'
                 and p_provider_store_id ~ '[^[:space:]]' and p_provider_product_id ~ '[^[:space:]]'
                 and p_provider_variant_id ~ '[^[:space:]]')) then
    -- an unexpected provider variant while a change is unresolved is a transition conflict,
    -- exactly as in the updated processor's mapping branch
    perform private.mark_billing_plan_change_review_v1(v_change_id, 'plan_change_variant_unexpected');
  end if;

  v_audit := private.record_billing_recovery_attempt_v1(
    'subscription_snapshot', p_environment, null, v_subscription.id,
    v_subscription.provider_subscription_id, 'operator_provider_snapshot', p_provider_updated_at,
    v_evidence, v_prior, v_applied, p_ticket_ref, p_reason, p_operator_label,
    v_outcome, v_error, p_review_token);

  return query select v_outcome, v_error, v_audit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Capacity: a pending downgrade is a second source of the target limit (C1 pattern).
-- ---------------------------------------------------------------------------

create or replace function public.resolve_employee_capacity_v2(
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
    select x.kind, x.checkout_id, x.slug, x.max_employees
    from (
      -- Status, not expiry, decides: creating/open checkouts are exactly the ones the created
      -- processor (directly or after recovery finalization) can still activate.
      select 'pending_checkout'::text as kind, c.id as checkout_id, p.slug::text as slug,
        p.max_employees, c.created_at, c.id as sort_id
      from public.billing_checkout_sessions c
      join public.plans p on p.id = c.requested_plan_id
      where c.salon_id = p_salon_id
        and c.status in ('creating', 'open')
        and p.max_employees is not null
      union all
      -- C2: an unresolved change (including manual_review) narrows to its target limit; an
      -- upgrade target is never below the current limit, so it changes nothing.
      select 'pending_plan_change'::text, null::uuid, p.slug::text, p.max_employees,
        pc.created_at, pc.id
      from public.billing_subscription_plan_changes pc
      join public.plans p on p.id = pc.target_plan_id
      where pc.salon_id = p_salon_id
        and pc.status in ('requested', 'unknown', 'confirmed', 'manual_review')
        and p.max_employees is not null
    ) x
    order by x.max_employees, x.created_at, x.sort_id
    limit 1
  )
  select b.has_full_access, b.access_reason, b.effective_plan_id, b.effective_plan_slug,
    b.max_employees,
    case when pending.kind is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.max_employees else b.max_employees end,
    case when pending.kind is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
        then pending.kind
      when b.access_source = 'billing_override' then 'override'
      else 'plan' end,
    case when pending.kind = 'pending_checkout'
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.checkout_id end,
    case when pending.kind is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.slug end,
    case when pending.kind is not null
          and (b.max_employees is null or pending.max_employees < b.max_employees)
      then pending.max_employees end,
    b.access_source, b.is_legacy_active
  from base b
  left join pending on true;
$$;

comment on function public.resolve_employee_capacity_v2(uuid, timestamptz) is
  'Canonical effective employee capacity: plan or override limit, narrowed to the target limit of a creating/open checkout (regardless of expiry) or of an unresolved plan change. Access and other capabilities stay with resolve_salon_access_v1.';

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
    -- so a checkout, plan change or activation committed by the previous holder is visible.
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
          when v_capacity.capacity_reason = 'pending_plan_change' then 'EMPLOYEE_PLAN_CHANGE_LIMIT_PENDING'
          else 'EMPLOYEE_LIMIT_REACHED' end;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function public.prepare_billing_plan_change_v1(uuid, uuid, uuid, timestamptz) owner to postgres;
alter function public.request_billing_plan_change_v1(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) owner to postgres;
alter function public.record_billing_plan_change_provider_result_v1(text,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) owner to postgres;
alter function public.evaluate_billing_plan_change_v1(text, uuid, timestamptz) owner to postgres;

revoke all on function public.prepare_billing_plan_change_v1(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.request_billing_plan_change_v1(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.record_billing_plan_change_provider_result_v1(text,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.evaluate_billing_plan_change_v1(text, uuid, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.prepare_billing_plan_change_v1(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.request_billing_plan_change_v1(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.record_billing_plan_change_provider_result_v1(text,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.evaluate_billing_plan_change_v1(text, uuid, timestamptz) to service_role;

comment on table public.billing_subscription_plan_changes is
  'C2 next-renewal plan change evidence. At most one unresolved (requested/unknown/confirmed/manual_review) row per subscription; while unresolved the subscription access period is capped at baseline_period_end and plan_id stays at from_plan_id. Server-only; contains no payloads, URLs, amounts or secrets.';
comment on function public.prepare_billing_plan_change_v1(uuid, uuid, uuid, timestamptz) is
  'Read-only eligibility for a Starter/Pro next-renewal plan change (owner, active provider-linked monthly subscription, no override, more than 48h to renewal, no unresolved change or purchase, downgrade employee precondition). Returns the baseline and a local state token for the adapter.';
comment on function public.request_billing_plan_change_v1(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) is
  'Service-role atomic plan-change intent: re-checks eligibility and the local state token under the subscription lock, validates the fresh provider read against the local paid period, re-checks the downgrade employee precondition under the capacity lock and records the immutable baseline before any provider PATCH.';
comment on function public.record_billing_plan_change_provider_result_v1(text,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) is
  'Service-role record of the single provider PATCH result or a later validated provider read. rejected only for an explicitly recognised not-applied response; 429/timeout/transport/unclear are ambiguous and stay blocking (unknown). Same-result replay is idempotent. Provider data only contributes confirmation evidence and never extends access by itself.';
comment on function public.evaluate_billing_plan_change_v1(text, uuid, timestamptz) is
  'Service-role idempotent re-evaluation of an unresolved plan change from already recorded evidence.';

commit;

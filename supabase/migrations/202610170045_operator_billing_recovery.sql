begin;

-- Minimal operator billing recovery (phase D).
--
-- Two narrowly scoped, service-role-only recovery paths:
--   1. Re-process an existing manual_review webhook event whose reason is on an explicit
--      allowlist and whose precondition is now met. The existing v2 processors do the work.
--   2. Apply a validated provider subscription snapshot to an already linked local subscription
--      using exactly the lifecycle rules of process_billing_subscription_updated_v2.
--      The snapshot is recorded as operator evidence; it is never stored as a webhook event.
-- Every explicit apply is recorded in an append-only audit table. Planning is read-only.

create table public.billing_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  recovery_kind text not null,
  environment text not null,
  webhook_event_id uuid,
  subscription_id uuid,
  provider_subscription_id text,
  evidence_source text not null,
  evidence_provider_updated_at timestamptz,
  evidence_fingerprint text,
  prior_state jsonb not null,
  applied_state jsonb,
  ticket_ref text not null,
  reason text not null,
  operator_label text not null,
  database_role text not null default session_user,
  outcome text not null,
  error_code text,
  review_token text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint billing_recovery_attempts_kind_check
    check (recovery_kind in ('event_reprocess', 'subscription_snapshot')),
  constraint billing_recovery_attempts_environment_check
    check (environment in ('test', 'live')),
  constraint billing_recovery_attempts_evidence_source_check
    check (evidence_source in ('existing_webhook_event', 'operator_provider_snapshot')),
  constraint billing_recovery_attempts_kind_target_check
    check (
      (recovery_kind = 'event_reprocess' and webhook_event_id is not null
        and evidence_source = 'existing_webhook_event')
      or (recovery_kind = 'subscription_snapshot' and subscription_id is not null
        and evidence_source = 'operator_provider_snapshot')
    ),
  constraint billing_recovery_attempts_fingerprint_check
    check (evidence_fingerprint is null or evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint billing_recovery_attempts_token_check check (review_token ~ '^[0-9a-f]{64}$'),
  constraint billing_recovery_attempts_ticket_check
    check (ticket_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{1,63}$'),
  constraint billing_recovery_attempts_reason_check
    check (pg_catalog.char_length(pg_catalog.btrim(reason)) between 10 and 500),
  constraint billing_recovery_attempts_operator_check
    check (operator_label ~ '^[A-Za-z0-9._@-]{1,64}$'),
  constraint billing_recovery_attempts_outcome_check check (outcome ~ '^[a-z0-9_]+$'),
  constraint billing_recovery_attempts_error_code_check
    check (error_code is null or error_code ~ '^[a-z0-9_]+$')
);

create index billing_recovery_attempts_subscription_idx
  on public.billing_recovery_attempts(subscription_id, created_at desc)
  where subscription_id is not null;
create index billing_recovery_attempts_event_idx
  on public.billing_recovery_attempts(webhook_event_id, created_at desc)
  where webhook_event_id is not null;

create function private.billing_recovery_attempts_immutable_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '0A000', message = 'BILLING_RECOVERY_AUDIT_IMMUTABLE';
end;
$$;

create trigger billing_recovery_attempts_immutable
before update or delete on public.billing_recovery_attempts
for each row execute function private.billing_recovery_attempts_immutable_v1();

alter table public.billing_recovery_attempts enable row level security;
revoke all on table public.billing_recovery_attempts from public, anon, authenticated, service_role;
grant select on table public.billing_recovery_attempts to service_role;

comment on table public.billing_recovery_attempts is
  'Append-only audit of explicit operator billing recovery applies. operator_label is an unauthenticated free-form label, not proof of identity; database_role is the connecting role. Contains no payloads, URLs or secrets.';

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create function private.billing_epoch_v1(p_value timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.date_part('epoch', p_value)::numeric::text;
$$;

create function private.billing_sha256_v1(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function private.billing_subscription_state_fingerprint_v1(p_subscription public.subscriptions)
returns text
language sql
immutable
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
    'provider_state_updated_at', private.billing_epoch_v1(p_subscription.provider_state_updated_at)
  ));
$$;

create function private.billing_snapshot_fingerprint_v1(
  p_environment text,
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
  p_provider_updated_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.billing_sha256_v1(pg_catalog.jsonb_build_object(
    'environment', p_environment,
    'provider_subscription_id', p_provider_subscription_id,
    'provider_customer_id', p_provider_customer_id,
    'provider_store_id', p_provider_store_id,
    'test_mode', p_test_mode,
    'provider_product_id', p_provider_product_id,
    'provider_variant_id', p_provider_variant_id,
    'provider_status', p_provider_status,
    'provider_cancelled', p_provider_cancelled,
    'provider_pause_mode', p_provider_pause_mode,
    'provider_pause_resumes_at', private.billing_epoch_v1(p_provider_pause_resumes_at),
    'provider_trial_ends_at', private.billing_epoch_v1(p_provider_trial_ends_at),
    'provider_renews_at', private.billing_epoch_v1(p_provider_renews_at),
    'provider_ends_at', private.billing_epoch_v1(p_provider_ends_at),
    'provider_created_at', private.billing_epoch_v1(p_provider_created_at),
    'provider_updated_at', private.billing_epoch_v1(p_provider_updated_at)
  ));
$$;

create function private.record_billing_recovery_attempt_v1(
  p_kind text,
  p_environment text,
  p_webhook_event_id uuid,
  p_subscription_id uuid,
  p_provider_subscription_id text,
  p_evidence_source text,
  p_evidence_provider_updated_at timestamptz,
  p_evidence_fingerprint text,
  p_prior_state jsonb,
  p_applied_state jsonb,
  p_ticket_ref text,
  p_reason text,
  p_operator_label text,
  p_outcome text,
  p_error_code text,
  p_review_token text
)
returns uuid
language sql
volatile
set search_path = ''
as $$
  insert into public.billing_recovery_attempts(
    recovery_kind, environment, webhook_event_id, subscription_id, provider_subscription_id,
    evidence_source, evidence_provider_updated_at, evidence_fingerprint, prior_state, applied_state,
    ticket_ref, reason, operator_label, outcome, error_code, review_token
  ) values (
    p_kind, p_environment, p_webhook_event_id, p_subscription_id, p_provider_subscription_id,
    p_evidence_source, p_evidence_provider_updated_at, p_evidence_fingerprint, p_prior_state,
    p_applied_state, p_ticket_ref, pg_catalog.btrim(p_reason), p_operator_label, p_outcome,
    p_error_code, p_review_token
  ) returning id;
$$;

create function private.validate_billing_recovery_input_v1(
  p_environment text,
  p_ticket_ref text,
  p_reason text,
  p_operator_label text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_ENVIRONMENT_INVALID';
  end if;
  if p_ticket_ref is null or p_ticket_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{1,63}$' then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_TICKET_REQUIRED';
  end if;
  if p_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 10 and 500 then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_REASON_REQUIRED';
  end if;
  if p_operator_label is null or p_operator_label !~ '^[A-Za-z0-9._@-]{1,64}$' then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_OPERATOR_REQUIRED';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot evaluation. Mirrors the decision rules of
-- process_billing_subscription_updated_v2 (identity, mapping, ordering, supported states).
-- A parity test keeps the two in step; there is no second lifecycle outside these rules.
-- ---------------------------------------------------------------------------

create function private.evaluate_billing_snapshot_recovery_v1(
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
  v_mapping_count integer;
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

  select pg_catalog.count(*) into v_mapping_count
  from public.billing_provider_prices m
  where m.provider = 'lemonsqueezy'
    and m.environment = p_environment
    and m.plan_id = p_subscription.plan_id
    and m.billing_interval = 'monthly'
    and m.provider_store_id = p_provider_store_id
    and m.provider_product_id = p_provider_product_id
    and m.provider_variant_id = p_provider_variant_id;
  if v_mapping_count <> 1 then
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

-- ---------------------------------------------------------------------------
-- Snapshot recovery: plan (read-only) and apply (explicit, audited, locked).
-- ---------------------------------------------------------------------------

create function public.plan_billing_subscription_recovery_v1(
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
  p_now timestamptz default pg_catalog.now()
)
returns table(
  verdict text,
  error_code text,
  local_status text,
  local_period_ends_at timestamptz,
  local_cancel_at_period_end boolean,
  local_provider_state_updated_at timestamptz,
  proposed_status text,
  proposed_period_ends_at timestamptz,
  proposed_cancel_at_period_end boolean,
  proposed_cancelled_at timestamptz,
  evidence_fingerprint text,
  review_token text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_eval record;
  v_evidence text;
begin
  if p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_RECOVERY_NOW_REQUIRED';
  end if;
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_ENVIRONMENT_INVALID';
  end if;
  if not public.billing_environment_matches_v1(p_environment) then
    return query select 'environment_mismatch'::text, 'recovery_environment_mismatch'::text,
      null::text, null::timestamptz, null::boolean, null::timestamptz, null::text,
      null::timestamptz, null::boolean, null::timestamptz, null::text, null::text;
    return;
  end if;

  select * into v_subscription from public.subscriptions where id = p_subscription_id;
  if not found then
    return query select 'not_found'::text, 'recovery_subscription_not_found'::text,
      null::text, null::timestamptz, null::boolean, null::timestamptz, null::text,
      null::timestamptz, null::boolean, null::timestamptz, null::text, null::text;
    return;
  end if;

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

  return query select
    v_eval.verdict, v_eval.error_code,
    v_subscription.status::text, v_subscription.current_period_ends_at,
    v_subscription.cancel_at_period_end, v_subscription.provider_state_updated_at,
    v_eval.proposed_status, v_eval.proposed_period_ends_at,
    v_eval.proposed_cancel_at_period_end, v_eval.proposed_cancelled_at,
    v_evidence,
    private.billing_sha256_v1(pg_catalog.jsonb_build_object(
      'local', private.billing_subscription_state_fingerprint_v1(v_subscription),
      'evidence', v_evidence,
      'verdict', v_eval.verdict,
      'proposed_status', v_eval.proposed_status,
      'proposed_period_ends_at', private.billing_epoch_v1(v_eval.proposed_period_ends_at),
      'proposed_cancel_at_period_end', v_eval.proposed_cancel_at_period_end,
      'proposed_cancelled_at', private.billing_epoch_v1(v_eval.proposed_cancelled_at)));
end;
$$;

create function public.apply_billing_subscription_recovery_v1(
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
  v_eval record;
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
  -- lock order mirrors process_billing_subscription_updated_v2: subscription, plan, mapping
  perform 1 from public.plans where id = v_subscription.plan_id for share;
  perform 1
  from public.billing_provider_prices
  where provider = 'lemonsqueezy' and environment = p_environment
    and plan_id = v_subscription.plan_id and billing_interval = 'monthly'
    and provider_store_id = p_provider_store_id
    and provider_product_id = p_provider_product_id
    and provider_variant_id = p_provider_variant_id
  for share;

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
    'provider_state_updated_at', v_subscription.provider_state_updated_at);

  v_outcome := v_eval.verdict;
  v_error := v_eval.error_code;

  if v_eval.verdict = 'eligible' and v_token is distinct from p_review_token then
    -- local state or provider evidence changed since the reviewed dry-run
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
-- Event reprocess: plan (read-only) and apply (explicit, audited, locked).
-- Reuses process_billing_subscription_{created,updated}_v2 unchanged.
-- ---------------------------------------------------------------------------

create function private.evaluate_billing_event_reprocess_v1(
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
  v_have_subscription boolean := false;
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
        and p_event.error_code = 'processor_retry_exhausted')
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
    else
      v_verdict := 'eligible';
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
        then private.billing_subscription_state_fingerprint_v1(v_subscription) else null end));
end;
$$;

create function public.plan_billing_event_reprocess_v1(
  p_environment text,
  p_webhook_event_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table(
  verdict text,
  error_code text,
  event_name text,
  prior_error_code text,
  attempt_count integer,
  subscription_id uuid,
  review_token text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.billing_webhook_events%rowtype;
  v_eval record;
begin
  if p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_RECOVERY_NOW_REQUIRED';
  end if;
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_ENVIRONMENT_INVALID';
  end if;
  if not public.billing_environment_matches_v1(p_environment) then
    return query select 'environment_mismatch'::text, 'recovery_environment_mismatch'::text,
      null::text, null::text, null::integer, null::uuid, null::text;
    return;
  end if;
  select * into v_event from public.billing_webhook_events where id = p_webhook_event_id;
  if not found or v_event.environment is distinct from p_environment then
    return query select 'not_found'::text, 'recovery_event_not_found'::text,
      null::text, null::text, null::integer, null::uuid, null::text;
    return;
  end if;
  select * into v_eval from private.evaluate_billing_event_reprocess_v1(p_environment, v_event, p_now);
  return query select v_eval.verdict, v_eval.error_code, v_event.event_name, v_event.error_code,
    v_event.processing_attempt_count, v_eval.subscription_id, v_eval.review_token;
end;
$$;

create function public.apply_billing_event_reprocess_v1(
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
  v_eval record;
  v_processor record;
  v_after public.billing_webhook_events%rowtype;
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
  elsif v_eval.verdict = 'eligible' then
    update public.billing_webhook_events
    set processing_status = 'received',
        error_code = null,
        processed_at = null,
        next_processing_attempt_at = p_now,
        last_processing_outcome = 'operator_reprocess',
        last_processing_attempt_at = p_now,
        processing_attempt_count = processing_attempt_count + 1,
        processing_lease_until = null,
        processing_claim_token = null,
        updated_at = p_now
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

-- ---------------------------------------------------------------------------
-- Privileges: service role only; nothing here is reachable from public roles.
-- ---------------------------------------------------------------------------

revoke all on function private.billing_recovery_attempts_immutable_v1() from public, anon, authenticated, service_role;
revoke all on function private.billing_epoch_v1(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.billing_sha256_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.billing_subscription_state_fingerprint_v1(public.subscriptions) from public, anon, authenticated, service_role;
revoke all on function private.billing_snapshot_fingerprint_v1(text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.record_billing_recovery_attempt_v1(text,text,uuid,uuid,text,text,timestamptz,text,jsonb,jsonb,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function private.validate_billing_recovery_input_v1(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function private.evaluate_billing_snapshot_recovery_v1(text,public.subscriptions,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.evaluate_billing_event_reprocess_v1(text,public.billing_webhook_events,timestamptz) from public, anon, authenticated, service_role;

revoke all on function public.plan_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.apply_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.plan_billing_event_reprocess_v1(text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.apply_billing_event_reprocess_v1(text,uuid,text,text,text,text,timestamptz) from public, anon, authenticated;

grant execute on function public.plan_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.apply_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz) to service_role;
grant execute on function public.plan_billing_event_reprocess_v1(text,uuid,timestamptz) to service_role;
grant execute on function public.apply_billing_event_reprocess_v1(text,uuid,text,text,text,text,timestamptz) to service_role;

comment on function public.plan_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) is
  'Read-only dry-run of applying a validated provider snapshot to one linked subscription. Mutates nothing.';
comment on function public.apply_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz) is
  'Explicit, audited, review-token-guarded application of a provider snapshot using the subscription_updated lifecycle rules. The snapshot is operator evidence, never a webhook event.';
comment on function public.plan_billing_event_reprocess_v1(text,uuid,timestamptz) is
  'Read-only dry-run of re-processing one allowlisted manual_review webhook event.';
comment on function public.apply_billing_event_reprocess_v1(text,uuid,text,text,text,text,timestamptz) is
  'Explicit, audited re-processing of one allowlisted manual_review webhook event through the existing v2 processors.';

commit;

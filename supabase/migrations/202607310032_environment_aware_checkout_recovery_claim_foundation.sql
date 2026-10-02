begin;

create table public.billing_checkout_recovery_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  checkout_session_id uuid not null
    references public.billing_checkout_sessions(id) on delete restrict,
  provider text not null,
  environment text not null,
  status text not null,
  outcome text,
  claim_token uuid not null,
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  attempt_number integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint billing_checkout_recovery_attempts_provider_check
    check (provider = 'lemonsqueezy'),
  constraint billing_checkout_recovery_attempts_environment_check
    check (environment in ('test', 'live')),
  constraint billing_checkout_recovery_attempts_status_check
    check (status in ('claimed', 'completed', 'abandoned')),
  constraint billing_checkout_recovery_attempts_outcome_check
    check (outcome is null or outcome in (
      'already_open', 'already_completed', 'still_pending', 'recovered_open',
      'provider_not_found', 'provider_unavailable', 'invalid_candidate',
      'ambiguous', 'pagination_limit_reached', 'claim_lost', 'manual_review',
      'configuration_error', 'invalid_provider_response'
    )),
  constraint billing_checkout_recovery_attempts_state_check check (
    (status = 'claimed' and outcome is null and completed_at is null)
    or
    (status = 'completed' and outcome is not null and outcome <> 'claim_lost'
      and completed_at is not null and completed_at < lease_expires_at)
    or
    (status = 'abandoned' and outcome = 'claim_lost'
      and completed_at is not null and completed_at >= lease_expires_at)
  ),
  constraint billing_checkout_recovery_attempts_lease_check
    check (lease_expires_at > claimed_at),
  constraint billing_checkout_recovery_attempts_number_check
    check (attempt_number > 0),
  constraint billing_checkout_recovery_attempts_timestamps_check
    check (updated_at >= created_at and claimed_at >= created_at and (completed_at is null or completed_at >= claimed_at)),
  constraint billing_checkout_recovery_attempts_number_unique
    unique (checkout_session_id, environment, attempt_number)
);

create unique index billing_checkout_recovery_attempts_active_unique
  on public.billing_checkout_recovery_attempts(checkout_session_id, environment)
  where status = 'claimed';

create index billing_checkout_recovery_attempts_checkout_audit_idx
  on public.billing_checkout_recovery_attempts(checkout_session_id, environment, attempt_number desc);

alter table public.billing_checkout_recovery_attempts enable row level security;
revoke all on table public.billing_checkout_recovery_attempts from public, anon, authenticated, service_role;
grant select on table public.billing_checkout_recovery_attempts to service_role;

create or replace function public.claim_billing_checkout_recovery_v1(
  p_checkout_session_id uuid,
  p_environment text,
  p_now timestamptz default pg_catalog.now(),
  p_lease_duration interval default interval '5 minutes'
)
returns table(
  claim_outcome text,
  recovery_attempt_id uuid,
  claim_token uuid,
  checkout_session_id uuid,
  ledger_status text,
  provider text,
  environment text,
  provider_session_id text,
  requested_plan_id uuid,
  salon_id uuid,
  idempotency_key uuid,
  ledger_created_at timestamptz,
  ledger_expires_at timestamptz,
  attempt_number integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout public.billing_checkout_sessions%rowtype;
  v_attempt public.billing_checkout_recovery_attempts%rowtype;
  v_attempt_number integer;
begin
  if p_checkout_session_id is null or p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_CHECKOUT_RECOVERY_ARGUMENT_REQUIRED';
  end if;
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_ENVIRONMENT_INVALID';
  end if;
  if p_lease_duration is null
     or p_lease_duration < interval '30 seconds'
     or p_lease_duration > interval '10 minutes' then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_LEASE_INVALID';
  end if;

  select c.* into v_checkout
  from public.billing_checkout_sessions c
  where c.id = p_checkout_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'BILLING_CHECKOUT_RECOVERY_CHECKOUT_NOT_FOUND';
  end if;
  if v_checkout.provider <> 'lemonsqueezy' then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_PROVIDER_UNSUPPORTED';
  end if;
  if v_checkout.environment <> p_environment then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_ENVIRONMENT_MISMATCH';
  end if;

  if v_checkout.status = 'open' then
    return query select 'already_open'::text, null::uuid, null::uuid, v_checkout.id,
      v_checkout.status, v_checkout.provider, v_checkout.environment, v_checkout.provider_session_id,
      v_checkout.requested_plan_id, v_checkout.salon_id, v_checkout.idempotency_key,
      v_checkout.created_at, v_checkout.expires_at, null::integer, null::timestamptz;
    return;
  end if;
  if v_checkout.status = 'completed' then
    return query select 'already_completed'::text, null::uuid, null::uuid, v_checkout.id,
      v_checkout.status, v_checkout.provider, v_checkout.environment, v_checkout.provider_session_id,
      v_checkout.requested_plan_id, v_checkout.salon_id, v_checkout.idempotency_key,
      v_checkout.created_at, v_checkout.expires_at, null::integer, null::timestamptz;
    return;
  end if;
  if v_checkout.status <> 'creating' then
    return query select 'manual_review'::text, null::uuid, null::uuid, v_checkout.id,
      v_checkout.status, v_checkout.provider, v_checkout.environment, v_checkout.provider_session_id,
      v_checkout.requested_plan_id, v_checkout.salon_id, v_checkout.idempotency_key,
      v_checkout.created_at, v_checkout.expires_at, null::integer, null::timestamptz;
    return;
  end if;

  update public.billing_checkout_recovery_attempts a
  set status = 'abandoned',
      outcome = 'claim_lost',
      completed_at = p_now,
      updated_at = p_now
  where a.checkout_session_id = v_checkout.id
    and a.environment = p_environment
    and a.status = 'claimed'
    and a.lease_expires_at <= p_now;

  select a.* into v_attempt
  from public.billing_checkout_recovery_attempts a
  where a.checkout_session_id = v_checkout.id
    and a.environment = p_environment
    and a.status = 'claimed'
  for update;

  if found then
    return query select 'already_claimed'::text, null::uuid, null::uuid, v_checkout.id,
      v_checkout.status, v_checkout.provider, v_checkout.environment, v_checkout.provider_session_id,
      v_checkout.requested_plan_id, v_checkout.salon_id, v_checkout.idempotency_key,
      v_checkout.created_at, v_checkout.expires_at, v_attempt.attempt_number, v_attempt.lease_expires_at;
    return;
  end if;

  select coalesce(max(a.attempt_number), 0) + 1 into v_attempt_number
  from public.billing_checkout_recovery_attempts a
  where a.checkout_session_id = v_checkout.id
    and a.environment = p_environment;

  insert into public.billing_checkout_recovery_attempts(
    checkout_session_id, provider, environment, status, claim_token,
    claimed_at, lease_expires_at, attempt_number, created_at, updated_at
  ) values (
    v_checkout.id, v_checkout.provider, v_checkout.environment, 'claimed', extensions.gen_random_uuid(),
    p_now, p_now + p_lease_duration, v_attempt_number, p_now, p_now
  ) returning * into v_attempt;

  return query select 'claimed'::text, v_attempt.id, v_attempt.claim_token, v_checkout.id,
    v_checkout.status, v_checkout.provider, v_checkout.environment, v_checkout.provider_session_id,
    v_checkout.requested_plan_id, v_checkout.salon_id, v_checkout.idempotency_key,
    v_checkout.created_at, v_checkout.expires_at, v_attempt.attempt_number, v_attempt.lease_expires_at;
end;
$$;

create or replace function public.complete_billing_checkout_recovery_attempt_v1(
  p_recovery_attempt_id uuid,
  p_claim_token uuid,
  p_environment text,
  p_outcome text,
  p_now timestamptz default pg_catalog.now()
)
returns table(
  completion_outcome text,
  recovery_attempt_id uuid,
  status text,
  outcome text,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.billing_checkout_recovery_attempts%rowtype;
begin
  if p_recovery_attempt_id is null or p_claim_token is null or p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_CHECKOUT_RECOVERY_ARGUMENT_REQUIRED';
  end if;
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_ENVIRONMENT_INVALID';
  end if;
  if p_outcome is null or p_outcome not in (
    'already_open', 'already_completed', 'still_pending', 'recovered_open',
    'provider_not_found', 'provider_unavailable', 'invalid_candidate',
    'ambiguous', 'pagination_limit_reached', 'manual_review',
    'configuration_error', 'invalid_provider_response'
  ) then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_OUTCOME_INVALID';
  end if;

  select a.* into v_attempt
  from public.billing_checkout_recovery_attempts a
  where a.id = p_recovery_attempt_id
  for update;

  if not found
     or v_attempt.claim_token is distinct from p_claim_token
     or v_attempt.environment is distinct from p_environment then
    return query select 'claim_lost'::text, p_recovery_attempt_id, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_attempt.status = 'completed' then
    if v_attempt.outcome is distinct from p_outcome then
      raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_OUTCOME_CONFLICT';
    end if;
    return query select 'already_completed'::text, v_attempt.id, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if v_attempt.status = 'abandoned' then
    return query select 'claim_lost'::text, v_attempt.id, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if v_attempt.status <> 'claimed' then
    return query select 'claim_lost'::text, v_attempt.id, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if v_attempt.lease_expires_at <= p_now then
    update public.billing_checkout_recovery_attempts a
    set status = 'abandoned', outcome = 'claim_lost', completed_at = p_now, updated_at = p_now
    where a.id = v_attempt.id
    returning a.* into v_attempt;
    return query select 'claim_lost'::text, v_attempt.id, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  update public.billing_checkout_recovery_attempts a
  set status = 'completed', outcome = p_outcome, completed_at = p_now, updated_at = p_now
  where a.id = v_attempt.id
  returning a.* into v_attempt;

  return query select 'completed'::text, v_attempt.id, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
end;
$$;

alter function public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval) owner to postgres;
alter function public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz) owner to postgres;

revoke all on function public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)
  from public, anon, authenticated;
grant execute on function public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)
  to service_role;
revoke all on function public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)
  to service_role;

comment on table public.billing_checkout_recovery_attempts is
  'Server-only PII-free audit of manual checkout recovery claims; never checkout or subscription authority.';
comment on function public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval) is
  'Claims one creating checkout ledger for manual recovery using a bounded lease and database-generated token; never mutates the ledger.';
comment on function public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz) is
  'Completes only the PII-free recovery audit attempt for an exact live claim; never mutates checkout or subscription state.';

commit;

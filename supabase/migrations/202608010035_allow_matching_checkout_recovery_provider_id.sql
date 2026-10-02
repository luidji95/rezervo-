begin;

-- A token-authoritative recovery may finalize a creating ledger when its
-- provider_session_id is either absent or already equals the confirmed
-- Lemon Squeezy Checkout UUID. Every other 034 invariant remains unchanged.
create or replace function public.finalize_billing_checkout_recovery_v1(
  p_recovery_attempt_id uuid,
  p_claim_token uuid,
  p_environment text,
  p_provider_checkout_id text,
  p_checkout_url_hash text,
  p_provider_expires_at timestamptz
)
returns table(
  finalization_outcome text,
  recovery_attempt_id uuid,
  ledger_status text,
  attempt_status text,
  audit_outcome text,
  attempt_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout_session_id uuid;
  v_checkout public.billing_checkout_sessions%rowtype;
  v_attempt public.billing_checkout_recovery_attempts%rowtype;
  v_now timestamptz;
  v_provider_collision boolean := false;
  v_constraint_name text;
begin
  if p_recovery_attempt_id is null or p_claim_token is null then
    raise exception using errcode = '22004', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ARGUMENT_REQUIRED';
  end if;
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ENVIRONMENT_INVALID';
  end if;
  if p_provider_checkout_id is null or p_provider_checkout_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_PROVIDER_ID_INVALID';
  end if;
  if p_checkout_url_hash is null or p_checkout_url_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_URL_HASH_INVALID';
  end if;
  if p_provider_expires_at is null then
    raise exception using errcode = '22004', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_EXPIRY_REQUIRED';
  end if;
  if not pg_catalog.isfinite(p_provider_expires_at) then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_EXPIRY_INVALID';
  end if;

  select a.checkout_session_id into v_checkout_session_id
  from public.billing_checkout_recovery_attempts a
  where a.id = p_recovery_attempt_id;

  if not found then
    return query select 'claim_lost'::text, p_recovery_attempt_id,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select c.* into v_checkout
  from public.billing_checkout_sessions c
  where c.id = v_checkout_session_id
  for update;

  if not found then
    return query select 'claim_lost'::text, p_recovery_attempt_id,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select a.* into v_attempt
  from public.billing_checkout_recovery_attempts a
  where a.id = p_recovery_attempt_id
  for update;

  if not found
     or v_attempt.checkout_session_id is distinct from v_checkout.id
     or v_attempt.claim_token is distinct from p_claim_token
     or v_attempt.environment is distinct from p_environment then
    return query select 'claim_lost'::text, p_recovery_attempt_id,
      v_checkout.status, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();

  if v_attempt.status = 'completed' then
    if v_attempt.outcome = 'recovered_open' then
      if v_checkout.status = 'open'
         and v_checkout.provider = 'lemonsqueezy'
         and v_checkout.environment = p_environment
         and v_checkout.provider_session_id = p_provider_checkout_id
         and v_checkout.checkout_url_hash = p_checkout_url_hash
         and v_checkout.expires_at is not distinct from p_provider_expires_at then
        return query select 'already_finalized'::text, v_attempt.id,
          v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
      else
        return query select 'finalization_conflict'::text, v_attempt.id,
          v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
      end if;
      return;
    end if;
    return query select 'attempt_state_conflict'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if v_attempt.status = 'abandoned' then
    return query select 'claim_lost'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if v_attempt.status <> 'claimed' then
    return query select 'attempt_state_conflict'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if v_attempt.lease_expires_at <= v_now then
    update public.billing_checkout_recovery_attempts a
    set status = 'abandoned', outcome = 'claim_lost', completed_at = v_now, updated_at = v_now
    where a.id = v_attempt.id
      and a.status = 'claimed'
      and a.claim_token = p_claim_token
      and a.environment = p_environment
    returning a.* into v_attempt;
    if not found then
      raise exception using errcode = '40001', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ATTEMPT_UPDATE_FAILED';
    end if;
    return query select 'claim_lost'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if v_attempt.provider <> 'lemonsqueezy'
     or v_checkout.provider <> 'lemonsqueezy'
     or v_checkout.environment is distinct from p_environment
     or v_checkout.environment is distinct from v_attempt.environment
     or v_checkout.status <> 'creating'
     or (
       v_checkout.provider_session_id is not null
       and v_checkout.provider_session_id is distinct from p_provider_checkout_id
     ) then
    update public.billing_checkout_recovery_attempts a
    set status = 'completed', outcome = 'manual_review', completed_at = v_now, updated_at = v_now
    where a.id = v_attempt.id and a.status = 'claimed'
      and a.claim_token = p_claim_token and a.environment = p_environment
      and a.lease_expires_at > v_now
    returning a.* into v_attempt;
    if not found then
      raise exception using errcode = '40001', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ATTEMPT_UPDATE_FAILED';
    end if;
    return query select 'ledger_state_conflict'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if p_provider_expires_at <= v_now then
    update public.billing_checkout_recovery_attempts a
    set status = 'completed', outcome = 'invalid_candidate', completed_at = v_now, updated_at = v_now
    where a.id = v_attempt.id and a.status = 'claimed'
      and a.claim_token = p_claim_token and a.environment = p_environment
      and a.lease_expires_at > v_now
    returning a.* into v_attempt;
    if not found then
      raise exception using errcode = '40001', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ATTEMPT_UPDATE_FAILED';
    end if;
    return query select 'provider_checkout_expired'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  if exists (
    select 1
    from public.billing_checkout_sessions c
    where c.provider = 'lemonsqueezy'
      and c.environment = p_environment
      and c.provider_session_id = p_provider_checkout_id
      and c.id <> v_checkout.id
  ) then
    update public.billing_checkout_recovery_attempts a
    set status = 'completed', outcome = 'manual_review', completed_at = v_now, updated_at = v_now
    where a.id = v_attempt.id and a.status = 'claimed'
      and a.claim_token = p_claim_token and a.environment = p_environment
      and a.lease_expires_at > v_now
    returning a.* into v_attempt;
    if not found then
      raise exception using errcode = '40001', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ATTEMPT_UPDATE_FAILED';
    end if;
    return query select 'provider_id_conflict'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  begin
    update public.billing_checkout_sessions c
    set status = 'open',
        provider_session_id = p_provider_checkout_id,
        checkout_url_hash = p_checkout_url_hash,
        expires_at = p_provider_expires_at,
        error_code = null,
        failed_at = null,
        completed_at = null,
        updated_at = v_now
    where c.id = v_checkout.id
      and c.provider = 'lemonsqueezy'
      and c.environment = p_environment
      and c.status = 'creating'
      and (
        c.provider_session_id is null
        or c.provider_session_id = p_provider_checkout_id
      )
    returning c.* into v_checkout;
    if not found then
      raise exception using errcode = '40001', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_LEDGER_UPDATE_FAILED';
    end if;

    update public.billing_checkout_recovery_attempts a
    set status = 'completed', outcome = 'recovered_open', completed_at = v_now, updated_at = v_now
    where a.id = v_attempt.id
      and a.checkout_session_id = v_checkout.id
      and a.provider = 'lemonsqueezy'
      and a.environment = p_environment
      and a.status = 'claimed'
      and a.claim_token = p_claim_token
      and a.lease_expires_at > v_now
    returning a.* into v_attempt;
    if not found then
      raise exception using errcode = '40001', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ATTEMPT_UPDATE_FAILED';
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'billing_checkout_sessions_provider_session_unique' then
        v_provider_collision := true;
      else
        raise;
      end if;
  end;

  if v_provider_collision then
    select c.* into v_checkout
    from public.billing_checkout_sessions c
    where c.id = v_checkout_session_id;
    update public.billing_checkout_recovery_attempts a
    set status = 'completed', outcome = 'manual_review', completed_at = v_now, updated_at = v_now
    where a.id = v_attempt.id and a.status = 'claimed'
      and a.claim_token = p_claim_token and a.environment = p_environment
      and a.lease_expires_at > v_now
    returning a.* into v_attempt;
    if not found then
      raise exception using errcode = '40001', message = 'BILLING_CHECKOUT_RECOVERY_FINALIZATION_ATTEMPT_UPDATE_FAILED';
    end if;
    return query select 'provider_id_conflict'::text, v_attempt.id,
      v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
    return;
  end if;

  return query select 'finalized'::text, v_attempt.id,
    v_checkout.status, v_attempt.status, v_attempt.outcome, v_attempt.completed_at;
end;
$$;

alter function public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz) owner to postgres;

revoke all on function public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)
  to service_role;

comment on function public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz) is
  'Token-authoritative atomic creating-to-open checkout recovery finalization allowing a null or identical canonical lowercase Lemon Squeezy Checkout UUID; never calls the provider or mutates subscriptions.';

commit;

begin;

-- C2 minimal operator recovery for unresolved plan changes (requested / unknown / manual_review).
-- Explicit, audited, one change per call, dry-run first. Reuses the D audit table and the C2
-- observation/evaluation authority. Two supported actions only:
--   record_observed     : a validated provider read that satisfies the existing E1 contract
--                         (target, period = baseline, provider version after the pre-request read and
--                         before the boundary). Never E2/E3; completion stays with the evaluator.
--   resolve_not_applied : the provider renewed on the PREVIOUS variant (applied lifecycle evidence),
--                         a paid renewal invoice exists for that period, the target was never observed
--                         and a fresh provider read still shows the previous variant. The change becomes
--                         not_applied and the cap is lifted to the already paid previous-plan period.
-- Everything else is reported as unsupported / needs investigation. No force-complete, force-reject or
-- timestamp override exists. The operator label is a free-form label, not an authenticated identity.

-- ---------------------------------------------------------------------------
-- Audit: allow the plan_change kind in the existing append-only table.
-- ---------------------------------------------------------------------------

alter table public.billing_recovery_attempts drop constraint billing_recovery_attempts_kind_check;
alter table public.billing_recovery_attempts add constraint billing_recovery_attempts_kind_check
  check (recovery_kind in ('event_reprocess', 'subscription_snapshot', 'plan_change'));
alter table public.billing_recovery_attempts drop constraint billing_recovery_attempts_kind_target_check;
alter table public.billing_recovery_attempts add constraint billing_recovery_attempts_kind_target_check
  check (
    (recovery_kind = 'event_reprocess' and webhook_event_id is not null
      and evidence_source = 'existing_webhook_event')
    or (recovery_kind in ('subscription_snapshot', 'plan_change') and subscription_id is not null
      and evidence_source = 'operator_provider_snapshot')
  );

-- ---------------------------------------------------------------------------
-- Row guard: unknown/manual_review -> not_applied only inside the operator resolution.
-- ---------------------------------------------------------------------------

create or replace function private.billing_plan_change_row_guard_v1()
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
    or (old.status in ('unknown', 'manual_review') and new.status = 'not_applied'
        and pg_catalog.current_setting('rezervo.plan_change_operator_resolution', true) = new.id::text)
  ) then
    raise exception using errcode = 'P0001', message = 'BILLING_PLAN_CHANGE_TRANSITION_INVALID';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared, read-only classification (same rules for dry-run and apply).
-- ---------------------------------------------------------------------------

create function private.evaluate_billing_plan_change_recovery_v1(
  p_change public.billing_subscription_plan_changes,
  p_subscription public.subscriptions,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_store_id text,
  p_test_mode boolean,
  p_provider_product_id text,
  p_provider_variant_id text,
  p_provider_status text,
  p_provider_pause_mode text,
  p_provider_trial_ends_at timestamptz,
  p_provider_renews_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_updated_at timestamptz,
  p_now timestamptz
)
returns table(verdict text, error_code text, action text, invoice_id text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind text;
  v_period timestamptz;
  v_invoice text;
  v_renewed_previous boolean;
begin
  if p_change.status not in ('requested', 'unknown', 'confirmed', 'manual_review') then
    return query select 'not_pending'::text, null::text, null::text, null::text;
    return;
  end if;
  if p_provider_subscription_id is distinct from p_change.provider_subscription_id
     or p_provider_customer_id is distinct from p_change.provider_customer_id
     or p_provider_store_id is distinct from p_change.provider_store_id
     or p_test_mode is distinct from (p_change.environment = 'test')
     or p_provider_updated_at is null then
    return query select 'identity_conflict'::text, 'recovery_plan_change_evidence_identity_conflict'::text, null::text, null::text;
    return;
  end if;
  if p_provider_pause_mode is not null or p_provider_trial_ends_at is not null
     or p_provider_status is null or p_provider_status not in ('active', 'cancelled', 'past_due', 'unpaid', 'expired') then
    return query select 'unsupported_state'::text, 'recovery_plan_change_provider_state_unsupported'::text, null::text, null::text;
    return;
  end if;
  v_kind := case
    when p_provider_product_id is not distinct from p_change.target_provider_product_id
         and p_provider_variant_id is not distinct from p_change.target_provider_variant_id then 'target'
    when p_provider_product_id is not distinct from p_change.from_provider_product_id
         and p_provider_variant_id is not distinct from p_change.from_provider_variant_id then 'from'
    else 'unexpected' end;
  if v_kind = 'unexpected' then
    return query select 'conflict'::text, 'recovery_plan_change_variant_unexpected'::text, null::text, null::text;
    return;
  end if;
  v_period := case when p_provider_status in ('cancelled', 'expired') then p_provider_ends_at else p_provider_renews_at end;

  -- record_observed: the existing E1 contract, unchanged (no timestamp override).
  if p_change.status in ('requested', 'unknown') and v_kind = 'target'
     and p_provider_status in ('active', 'cancelled')
     and v_period = p_change.baseline_period_end
     and p_provider_updated_at < p_change.baseline_period_end
     and p_provider_updated_at > p_change.baseline_provider_updated_at then
    return query select 'eligible'::text, null::text, 'record_observed'::text, null::text;
    return;
  end if;

  -- resolve_not_applied: renewed on the previous plan, paid, target never observed.
  v_renewed_previous := p_change.target_observed_at is null
    and (p_change.status in ('requested', 'unknown')
         or (p_change.status = 'manual_review' and p_change.conflict_code = 'plan_change_renewed_on_previous_plan'))
    and p_change.observed_product_id is not distinct from p_change.from_provider_product_id
    and p_change.observed_variant_id is not distinct from p_change.from_provider_variant_id
    and p_change.observed_status in ('active', 'cancelled')
    and p_change.observed_period_end > p_change.baseline_period_end
    and p_change.observed_period_end <= p_change.baseline_period_end + interval '1 month' + interval '4 days'
    and p_change.observed_provider_updated_at is not distinct from p_subscription.provider_state_updated_at
    and p_subscription.status in ('active', 'cancelled');
  if v_renewed_previous then
    if v_kind <> 'from' or p_provider_updated_at < p_change.observed_provider_updated_at
       or v_period is null or v_period < p_change.observed_period_end then
      return query select 'precondition_unmet'::text, 'recovery_plan_change_fresh_read_not_previous_plan'::text, null::text, null::text;
      return;
    end if;
    select i.provider_invoice_id into v_invoice
    from public.billing_webhook_subscription_invoice_facts i
    where i.provider = p_change.provider and i.environment = p_change.environment
      and i.provider_subscription_id = p_change.provider_subscription_id
      and i.provider_customer_id = p_change.provider_customer_id
      and i.provider_store_id = p_change.provider_store_id
      and i.billing_reason = 'renewal' and i.invoice_status = 'paid'
      and i.provider_invoice_created_at >= p_change.baseline_period_end
      and i.provider_invoice_created_at < p_change.observed_period_end
      and not exists (select 1 from public.billing_subscription_plan_changes o
                      where o.provider = i.provider and o.environment = i.environment
                        and o.renewal_invoice_id = i.provider_invoice_id)
    order by i.provider_invoice_created_at, i.provider_invoice_id
    limit 1;
    if v_invoice is null then
      return query select 'precondition_unmet'::text, 'recovery_plan_change_payment_evidence_missing'::text, null::text, null::text;
      return;
    end if;
    return query select 'eligible'::text, null::text, 'resolve_not_applied'::text, v_invoice;
    return;
  end if;

  -- Precise reasons for everything that is not supported.
  if p_change.status = 'manual_review' then
    return query select 'unsupported'::text,
      case p_change.conflict_code
        when 'plan_change_evidence_order_conflict' then 'recovery_plan_change_e1_order_unprovable'
        when 'plan_change_renewed_on_previous_plan' then 'recovery_plan_change_previous_plan_evidence_incomplete'
        else 'recovery_plan_change_conflict_unsupported' end,
      null::text, null::text;
    return;
  end if;
  if p_change.status = 'confirmed' then
    return query select 'precondition_unmet'::text,
      case when p_change.observed_variant_id is not distinct from p_change.target_provider_variant_id
                and p_change.observed_period_end > p_change.baseline_period_end
        then 'recovery_plan_change_payment_evidence_missing'
        else 'recovery_plan_change_lifecycle_evidence_missing' end,
      null::text, null::text;
    return;
  end if;
  if v_kind = 'target' then
    return query select 'unsupported'::text, 'recovery_plan_change_pre_boundary_evidence_missing'::text, null::text, null::text;
    return;
  end if;
  if v_period is not null and v_period <= p_change.baseline_period_end then
    -- Provider still on the previous plan before the renewal: an earlier PATCH may still be pending
    -- or never sent; a read with the old variant proves neither.
    return query select 'unsupported'::text, 'recovery_plan_change_dispatch_unresolved'::text, null::text, null::text;
    return;
  end if;
  return query select 'precondition_unmet'::text, 'recovery_plan_change_previous_plan_evidence_incomplete'::text, null::text, null::text;
end;
$$;

revoke all on function private.evaluate_billing_plan_change_recovery_v1(public.billing_subscription_plan_changes, public.subscriptions,
  text,text,text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;

create function private.billing_plan_change_recovery_token_v1(
  p_change public.billing_subscription_plan_changes,
  p_subscription public.subscriptions,
  p_evidence text,
  p_verdict text,
  p_action text,
  p_invoice text
)
returns text
language sql
stable
set search_path = ''
as $$
  select private.billing_sha256_v1(pg_catalog.jsonb_build_object(
    'change', pg_catalog.to_jsonb(p_change),
    'local', private.billing_subscription_state_fingerprint_v1(p_subscription),
    'evidence', p_evidence,
    'verdict', p_verdict,
    'action', p_action,
    'invoice', p_invoice,
    'active_employees', (select pg_catalog.count(*) from public.employees e
                         where e.salon_id = p_change.salon_id and e.is_active)));
$$;

revoke all on function private.billing_plan_change_recovery_token_v1(public.billing_subscription_plan_changes, public.subscriptions, text, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dry-run (read-only) and apply (explicit, audited, locked).
-- ---------------------------------------------------------------------------

create function public.plan_billing_plan_change_recovery_v1(
  p_environment text,
  p_plan_change_id uuid,
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
  proposed_action text,
  change_status text,
  baseline_period_end timestamptz,
  local_period_ends_at timestamptz,
  evidence_fingerprint text,
  review_token text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_change public.billing_subscription_plan_changes%rowtype;
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
    return query select 'environment_mismatch'::text, 'recovery_environment_mismatch'::text, null::text, null::text,
      null::timestamptz, null::timestamptz, null::text, null::text;
    return;
  end if;
  select * into v_change from public.billing_subscription_plan_changes where id = p_plan_change_id;
  if not found or v_change.environment is distinct from p_environment then
    return query select 'not_found'::text, 'recovery_plan_change_not_found'::text, null::text, null::text,
      null::timestamptz, null::timestamptz, null::text, null::text;
    return;
  end if;
  select * into v_subscription from public.subscriptions where id = v_change.subscription_id;
  v_evidence := private.billing_snapshot_fingerprint_v1(
    p_environment, p_provider_subscription_id, p_provider_customer_id, p_provider_store_id,
    p_test_mode, p_provider_product_id, p_provider_variant_id, p_provider_status,
    p_provider_cancelled, p_provider_pause_mode, p_provider_pause_resumes_at,
    p_provider_trial_ends_at, p_provider_renews_at, p_provider_ends_at,
    p_provider_created_at, p_provider_updated_at);
  select * into v_eval from private.evaluate_billing_plan_change_recovery_v1(
    v_change, v_subscription, p_provider_subscription_id, p_provider_customer_id, p_provider_store_id, p_test_mode,
    p_provider_product_id, p_provider_variant_id, p_provider_status, p_provider_pause_mode, p_provider_trial_ends_at,
    p_provider_renews_at, p_provider_ends_at, p_provider_updated_at, p_now);
  return query select v_eval.verdict, v_eval.error_code, v_eval.action, v_change.status,
    v_change.baseline_period_end, v_subscription.current_period_ends_at, v_evidence,
    private.billing_plan_change_recovery_token_v1(v_change, v_subscription, v_evidence, v_eval.verdict, v_eval.action, v_eval.invoice_id);
end;
$$;

create function public.apply_billing_plan_change_recovery_v1(
  p_environment text,
  p_plan_change_id uuid,
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
returns table(outcome text, error_code text, plan_change_status text, audit_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subscription_id uuid;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_eval record;
  v_evidence text;
  v_token text;
  v_outcome text;
  v_error text;
  v_prior jsonb;
  v_applied jsonb;
  v_audit uuid;
begin
  if p_now is null then
    raise exception using errcode = '22004', message = 'BILLING_RECOVERY_NOW_REQUIRED';
  end if;
  perform private.validate_billing_recovery_input_v1(p_environment, p_ticket_ref, p_reason, p_operator_label);
  if p_review_token is null or p_review_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'BILLING_RECOVERY_REVIEW_TOKEN_REQUIRED';
  end if;
  if not public.billing_environment_matches_v1(p_environment) then
    return query select 'environment_mismatch'::text, 'recovery_environment_mismatch'::text, null::text, null::uuid;
    return;
  end if;
  select c.subscription_id into v_subscription_id from public.billing_subscription_plan_changes c
  where c.id = p_plan_change_id and c.environment = p_environment;
  if v_subscription_id is null then
    return query select 'not_found'::text, 'recovery_plan_change_not_found'::text, null::text, null::uuid;
    return;
  end if;

  -- Same lock order as every C2 writer: subscription, then the plan-change row.
  select * into v_subscription from public.subscriptions where id = v_subscription_id for update;
  select * into v_change from public.billing_subscription_plan_changes where id = p_plan_change_id for update;

  v_evidence := private.billing_snapshot_fingerprint_v1(
    p_environment, p_provider_subscription_id, p_provider_customer_id, p_provider_store_id,
    p_test_mode, p_provider_product_id, p_provider_variant_id, p_provider_status,
    p_provider_cancelled, p_provider_pause_mode, p_provider_pause_resumes_at,
    p_provider_trial_ends_at, p_provider_renews_at, p_provider_ends_at,
    p_provider_created_at, p_provider_updated_at);
  select * into v_eval from private.evaluate_billing_plan_change_recovery_v1(
    v_change, v_subscription, p_provider_subscription_id, p_provider_customer_id, p_provider_store_id, p_test_mode,
    p_provider_product_id, p_provider_variant_id, p_provider_status, p_provider_pause_mode, p_provider_trial_ends_at,
    p_provider_renews_at, p_provider_ends_at, p_provider_updated_at, p_now);
  v_token := private.billing_plan_change_recovery_token_v1(v_change, v_subscription, v_evidence, v_eval.verdict, v_eval.action, v_eval.invoice_id);

  v_prior := pg_catalog.jsonb_build_object(
    'plan_change_id', v_change.id, 'plan_change_status', v_change.status, 'conflict_code', v_change.conflict_code,
    'baseline_period_end', v_change.baseline_period_end, 'subscription_status', v_subscription.status,
    'current_period_ends_at', v_subscription.current_period_ends_at,
    'provider_state_updated_at', v_subscription.provider_state_updated_at);
  v_outcome := case when v_eval.verdict = 'not_pending' then 'no_change' else v_eval.verdict end;
  v_error := v_eval.error_code;

  if v_eval.verdict = 'eligible' and v_token is distinct from p_review_token then
    v_outcome := 'stale';
    v_error := 'recovery_review_token_stale';
  elsif v_eval.verdict = 'eligible' and v_eval.action = 'record_observed' then
    perform private.observe_billing_plan_change_v1(
      v_change.id, 'operator_provider_read', p_provider_store_id, p_provider_product_id, p_provider_variant_id,
      p_provider_status, p_provider_renews_at, p_provider_ends_at, p_provider_updated_at, false, p_now);
    perform private.evaluate_billing_plan_change_v1(v_subscription.id, p_now);
    select * into v_change from public.billing_subscription_plan_changes where id = p_plan_change_id;
    v_outcome := 'recorded';
    v_applied := pg_catalog.jsonb_build_object('action', 'record_observed', 'plan_change_status', v_change.status,
      'confirmed_provider_updated_at', v_change.confirmed_provider_updated_at);
  elsif v_eval.verdict = 'eligible' and v_eval.action = 'resolve_not_applied' then
    -- Terminalise first (the subscription guard then allows lifting the cap), inside the operator scope only.
    perform pg_catalog.set_config('rezervo.plan_change_operator_resolution', v_change.id::text, true);
    -- The paid renewal invoice is claimed in the same column as a completion invoice, so the existing
    -- unique index (provider, environment, renewal_invoice_id) makes every use exclusive.
    update public.billing_subscription_plan_changes
    set status = 'not_applied', resolved_at = p_now, renewal_invoice_id = v_eval.invoice_id,
        conflict_code = coalesce(conflict_code, 'operator_resolved_previous_plan_renewal')
    where id = v_change.id;
    perform pg_catalog.set_config('rezervo.plan_change_operator_resolution', '', true);
    update public.subscriptions
    set current_period_ends_at = v_change.observed_period_end, updated_at = p_now
    where id = v_subscription.id and current_period_ends_at < v_change.observed_period_end;
    v_outcome := 'resolved_not_applied';
    v_applied := pg_catalog.jsonb_build_object('action', 'resolve_not_applied', 'plan_change_status', 'not_applied',
      'current_period_ends_at', v_change.observed_period_end, 'renewal_invoice_id', v_eval.invoice_id);
  end if;

  v_audit := private.record_billing_recovery_attempt_v1(
    'plan_change', p_environment, null, v_subscription.id, v_change.provider_subscription_id,
    'operator_provider_snapshot', p_provider_updated_at, v_evidence, v_prior, v_applied,
    p_ticket_ref, p_reason, p_operator_label, v_outcome, v_error, p_review_token);

  select * into v_change from public.billing_subscription_plan_changes where id = p_plan_change_id;
  return query select v_outcome, v_error, v_change.status, v_audit;
end;
$$;

alter function public.plan_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) owner to postgres;
alter function public.apply_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz) owner to postgres;
revoke all on function public.plan_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.plan_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.apply_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz) to service_role;

comment on function public.plan_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) is
  'Read-only C2 operator dry-run for one unresolved plan change with a validated provider snapshot: verdict, proposed action (record_observed | resolve_not_applied) or a precise unsupported reason, and a review token over change, subscription, evidence, invoice and capacity state.';
comment on function public.apply_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz) is
  'Explicit, audited C2 operator recovery. Re-evaluates under the subscription and plan-change locks; applies only the reviewed eligible action; never completes a change, assigns the target plan or overrides ordering.';

commit;

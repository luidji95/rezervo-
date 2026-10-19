# C2: Starter/Pro plan change from the next renewal (database foundation)

Migration: `supabase/migrations/202610190047_c2_next_renewal_plan_change.sql`.

Status: **local database foundation only, default-off.** No user route, provider adapter or UI calls
these RPCs. The migration is not applied remotely. Provider semantics below are documented or
sandbox-observed assumptions, not proven by these local tests. C2 and live billing are not complete.

## Product contract

- Starter/Pro monthly. Upgrade and downgrade take effect from the next renewal; no immediate charge
  and no proration credit (`disable_prorations`).
- Until the end of the already paid period the current plan and its capabilities stay.
- A new access period, on either plan, needs evidence of a paid renewal. Failed renewal does not
  extend the previous period; the existing failed-payment / read-only contract applies, with no new
  grace.
- Downgrade requires the active employee count to already fit the target plan; while pending, new
  activations are limited to the target. Upgrade raises nothing before completion. No automatic
  deactivation.

**MVP limits (documented, enforced).** A new request is refused when 48 hours or less remain before
the renewal (`BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE`). The buffer reduces the renewal race; it does
not prove provider atomicity. A pending change cannot be cancelled or replaced by the user.

## Where the provider period and the paid-access boundary live

| Data | Location |
| --- | --- |
| Paid access boundary (what DB and TS access read) | `subscriptions.current_period_ends_at` |
| Effective plan until completion | `subscriptions.plan_id` (= `from_plan_id`) |
| Immutable effective date | `billing_subscription_plan_changes.baseline_period_end` |
| Observed provider period/status/variant | `observed_*` columns of the plan-change row |
| Pre-boundary confirmation (E1) | `confirmed_provider_updated_at`, `confirmed_source` |
| Completion invoice (E3) | `renewal_invoice_id` (unique per provider/environment) |

While a change is unresolved (`requested`, `unknown`, `confirmed`, `manual_review`), every lifecycle
writer caps `current_period_ends_at` at `baseline_period_end` and keeps `plan_id`. The trigger
`subscriptions_plan_change_guard` rejects any other writer (`BILLING_PLAN_CHANGE_GUARD_PERIOD_CAPPED`,
`BILLING_PLAN_CHANGE_GUARD_PLAN_LOCKED`). `resolve_salon_access_v1` and the TypeScript resolver read
the same row and are unchanged; after the baseline without completion both report read-only
(`period_expired`, or the lifecycle status such as `past_due`). Non-transition subscriptions keep
the existing renewal contract unchanged.

## Lifecycle of a change

| Status | Meaning | Leaves by |
| --- | --- | --- |
| `requested` | intent and baseline recorded before the PATCH | E1 evidence → `confirmed`; ambiguous PATCH → `unknown`; definitive rejection with no target ever observed → `not_applied`; conflict → `manual_review`; subscription expired → `abandoned` |
| `unknown` | PATCH outcome not known (timeout/5xx, or accepted response still showing the old variant) | E1 evidence → `confirmed`; conflict → `manual_review`; expired → `abandoned` |
| `confirmed` | E1 recorded | E2+E3 → `completed`; conflict → `manual_review`; expired → `abandoned` |
| `manual_review` | conflict; **blocking**, never completes automatically | explicit operator resolution (not implemented in this phase) |
| `completed` / `not_applied` / `abandoned` | terminal, immutable | — |

Timeout/5xx is never `not_applied`. Exactly one PATCH attempt is recorded per change; recording
the same result again is an idempotent replay, a different second result is refused
(`BILLING_PLAN_CHANGE_ATTEMPT_ALREADY_RECORDED`). There is no automatic repeat.

**Result classification for the adapter (DB cannot verify it):**

- `rejected` only for an explicitly recognised provider response proving the change was not
  applied. Not every 4xx qualifies.
- `ambiguous` for 429, timeout, transport failure, 5xx and any unclear response → `unknown`
  (blocking, resolved only by later provider evidence or an operator).
- `accepted` (HTTP 2xx with a validated subscription body) is neither a payment nor a completion;
  it only contributes E1 confirmation evidence. An accepted body that does not show the target
  leaves the change `unknown`.
- `observed` for a later validated provider read; idempotent.

Durable intent exists before the PATCH (`request_billing_plan_change_v1`), and evaluation
(`evaluate_billing_plan_change_v1`) is idempotent.

## Completion evidence (shared evaluator `private.evaluate_billing_plan_change_v1`)

- **E1** — a validated provider state (webhook, PATCH response or later read) with the target
  product/variant, status `active`/`cancelled`, period end exactly `baseline_period_end`, and a
  provider `updated_at` that is after the pre-request read and before the baseline. A period that
  has not moved is not by itself treated as pre-boundary evidence.
  Ordering compares provider `updated_at` values only (the request stores the provider `updated_at`
  of the pre-request read, never the local read time). **Precision limit:** the provider reports
  `updated_at` in whole seconds in the observed sandbox data. A target state with exactly the same
  `updated_at` as the pre-request read cannot be ordered and goes to `manual_review`
  (`plan_change_evidence_order_conflict`); this fails closed and needs an operator. One second newer
  confirms. A pre-boundary E1 that is delivered after the boundary still confirms (its lifecycle
  part is refused as before); a target state whose provider version is at/after the boundary is not
  E1 and the change stays unresolved and read-only.
- **E2** — the newest *applied lifecycle* state (updated processor or D snapshot apply, not a bare
  HTTP read) shows the target, status `active`/`cancelled`, a period end after the baseline (sanity
  bound: at most one month plus 4 days), with `updated_at` after E1. No later observation of the
  previous variant after E1 (`plan_change_variant_reverted`).
- **E3** — a durable paid `renewal` invoice of the same provider subscription, customer, store and
  environment, created at/after the baseline, after E1 and before the renewed period end, not used
  by any other change. Initial, `updated` and older renewal invoices never qualify.

Completion terminalises the row first, then sets `plan_id` to the target and
`current_period_ends_at` to the observed renewed end. Every arrival order of E1/E2/E3 (including a
late, stale E1 webhook) gives the same outcome; the same delivery twice has no second effect.

**Assumption, not a provider guarantee.** The invoice object carries no plan, variant or operation
identifier. E1–E3 are a conditional evidence contract built on the documented rule that with
`disable_prorations` the new price is charged at the next renewal; they are not a direct
invoice→plan link. Also assumed: invoice `created_at` and subscription `updated_at` come from one
consistent provider clock, and a renewal invoice is not created before `renews_at` (when it is, the
change stays unresolved: read-only, never wider access). Portal plan switching must be disabled.

### Conflicts → `manual_review` (cap stays)

`plan_change_variant_unexpected` (neither recorded variant), `plan_change_store_conflict`,
`plan_change_evidence_order_conflict`, `plan_change_renewed_on_previous_plan` (provider renewed on
the old variant: renewal race), `plan_change_variant_reverted`, `plan_change_renewal_period_unexpected`,
`plan_change_rejection_conflict`, `plan_change_provider_identity_conflict`,
`plan_change_provider_state_unsupported`. A change waiting without E1 after the baseline stays
`requested`/`unknown`: equally blocking and read-only; it needs operator investigation.

### Cancel, resume, expiry

Cancel before the baseline keeps the paid remainder (`cancelled_until_period_end`); the change stays
pending because the provider variant stays the target. Resume continues it. Expiry abandons the change;
the existing `processor_updated_expired_reactivation_unsupported` / `plan_change_unsupported` rules keep
a terminal change from re-opening access. No provider rollback or refund exists here.

### `subscription_payment_recovered`

Not ingested (stored as `ignored`, as before). If a failed renewal is later paid and the provider
sends only `subscription_payment_recovered` without `subscription_payment_success`, no E3 exists:
the change stays `confirmed`, access stays read-only after the baseline, and an operator must
investigate. Which event the provider sends in that case is not verified.

## RPC contract (service role only)

| RPC | Purpose |
| --- | --- |
| `prepare_billing_plan_change_v1(salon, actor, target, now)` | read-only eligibility; baseline, target variant and a local `state_token` for the adapter's provider GET |
| `request_billing_plan_change_v1(...)` | after the GET, before the PATCH: re-checks eligibility and the token under the subscription lock, validates the fresh provider read against the local paid period (same customer/store/from-variant, `active`, not cancelled, `renews_at` = local period end, not older than local state, read at most 10 minutes old), re-checks the downgrade employee precondition under the capacity lock, records the immutable baseline |
| `record_billing_plan_change_provider_result_v1(env, change, result, snapshot…)` | `accepted` / `rejected` / `ambiguous` for the single PATCH, or `observed` for a later read; contributes confirmation evidence only |
| `evaluate_billing_plan_change_v1(env, subscription, now)` | idempotent re-evaluation from recorded evidence |

Eligibility: owner of the salon; active provider-linked Lemon Squeezy monthly subscription in the
database runtime environment; no active override; not cancelled, past due, expired, legacy or trial;
target is a different active Starter/Pro plan with exactly one active monthly mapping in the same
store and currency; more than 48 hours to the baseline; no unresolved change, open checkout or
unresolved purchase activation; downgrade employee precondition.

**Trust boundary.** Provider evidence passed by the service role (GET, PATCH response, later reads)
is trusted as validated by the server adapter, exactly like D snapshot recovery. The database cannot
prove the origin of arbitrary service-role parameters. The provider GET and PATCH happen outside any
database transaction; the request RPC re-checks the local version (state token) after the read.

## Integration

| Caller | Behaviour with an unresolved change |
| --- | --- |
| `process_billing_subscription_updated_v2` (webhook route, retry worker, D event reprocess) | the recorded target variant is expected; identity/ordering/same-timestamp rules unchanged; period capped; every verified delivery (also stale) contributes E1 facts; observation + evaluation |
| `ingest_billing_subscription_invoice_evidence_v1` | evidence recording unchanged; a newly recorded `renewal` invoice runs the evaluator |
| D snapshot plan/apply (`private.evaluate_billing_snapshot_recovery_v1`) | same expected-variant and cap rules; apply records the observation and runs the evaluator; never completes without E3; unexpected variant marks the change |
| D review tokens | `private.billing_subscription_state_fingerprint_v1` now includes the unresolved change, so snapshot and event-reprocess tokens go stale when it moves |
| Read-only reconciliation | unchanged and still read-only; with a capped period it reports drift, which is expected while a change is pending |
| `resolve_employee_capacity_v2` / `enforce_employee_capacity_v1` | unresolved change narrows to the target limit (`pending_plan_change`, `EMPLOYEE_PLAN_CHANGE_LIMIT_PENDING`), also under an override created later |

Lock protocol (no writer takes the subscription after the plan-change row or the capacity lock):

- updated processor: event → facts → subscription → plan (share) → mapping (share) → plan change
- invoice ingest: invoice advisory → event → invoice facts → subscription → plan change
- snapshot apply: subscription → plan (share) → mapping (share) → plan change
- request: subscription → plans (share) → plan change → employee-capacity advisory
- provider result / evaluate: subscription → plan change
- employee trigger: employee row → employee-capacity advisory (reads only)
- C1 acquisition / created processor / activation recovery: unchanged (checkout rows → plan →
  subscription → capacity); they never touch plan-change rows.

## Tests (disposable PostgreSQL only)

- `npm run test:billing-c2-plan-change-db` — guards, 48 h boundary, duplicates, E1/E2/E3 orders,
  stale/unrelated/reused invoices, timeout/unknown, cancel/resume/expired, conflicts, guard trigger,
  D snapshot gate and webhook/snapshot parity, non-transition regression.
- `npm run test:billing-c2-plan-change-concurrency` — downgrade request vs activation (both orders),
  parallel requests, invoice vs updated (both orders, repeated), duplicate invoice deliveries,
  snapshot vs webhook, PATCH result vs webhook.
- `npm run test:billing-c2-access-parity` — DB/TS access parity over the capped row in every phase.
- Review regressions (contract section 10): atomic completion rollback under an injected failure,
  invoice used once (unique index), completed change does not block the next renewal or a new
  change, `not_applied` followed by a target state, E1 timestamp precision cases, idempotent result
  replay, D event-reprocess token covering the change, service_role cannot write the evidence or
  extend the capped period.

`reminder_calendar_claim_quota_contract.sql` must be run through `npm run
test:reminder-claim-quota-db` (it needs `supabase/baseline/local_platform_grant_normalization.sql`);
applied alone it fails with `PERIOD_EXECUTE_ACL` with or without this migration.

## Release gates (not provable by these tests)

1. Sandbox: Starter→Pro with `disable_prorations` (not yet observed: no invoice, `renews_at`
   unchanged), and one real renewal after a change, showing the paid `renewal` invoice and the
   renewed `subscription_updated` (order and timestamps relative to `renews_at`).
2. Which paid event arrives when a failed renewal is later recovered.
3. Customer portal plan switching disabled in the provider dashboard.
4. TS provider adapter/endpoint, UI, then remote migration and live acceptance as separate steps.

# C2: Starter/Pro plan change from the next renewal

Migration: `supabase/migrations/202610190047_c2_next_renewal_plan_change.sql`.

Status: **local database foundation, server endpoint and billing UI, all default-off.** The migration is not applied remotely. Provider semantics below are documented or
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

## Server endpoint and Lemon Squeezy adapter (default-off)

Code: `src/features/billing/planChange/`, routes `src/app/api/billing/plan-change/route.ts` and
`src/app/api/billing/plan-change/status/route.ts`.

**Flag.** `BILLING_PLAN_CHANGE_ENABLED === "true"` plus a complete trusted Lemon Squeezy configuration
for the deployed `BILLING_ENVIRONMENT` (`resolveLemonSqueezyProviderConfig`). Not set anywhere.

**Order of checks** (both routes):

1. Authentication: `getAuthenticatedRequestUser` verifies the bearer token (a Supabase Auth call). No
   token or an invalid one → `401`; nothing else runs.
2. Request shape (no I/O): query string, size, content type, exact body → `400`.
3. Configuration (no I/O): flag off or incomplete/invalid configuration → `503
   BILLING_PLAN_CHANGE_DISABLED`; no database call and no provider call.
4. Runtime parity: one read-only database call, `billing_environment_matches_v1`. Mismatch or error →
   the same `503`; no billing RPC and no provider call follow. The response never says which of 3/4
   failed.
5. Owner lookup (service-role read of `salons.owner_id`), then the billing RPCs and the provider
   calls of the flow below.

**Owner and tenant.** The user comes from the verified bearer token (`getAuthenticatedRequestUser`);
the salon is the one whose `owner_id` is that user (none → `403`, managers/employees included;
more than one → not eligible). The database re-checks ownership. Authentication is a bearer token,
not a cookie, so there is no ambient-credential CSRF path; no origin allowlist exists in this
codebase and none is added here.

**Request contract.** `POST /api/billing/plan-change`, `Content-Type: application/json`, body
exactly `{"targetPlan":"starter"|"pro"}` (max 256 bytes), no query string. Provider, store,
subscription, variant and environment are never accepted from the browser; the target variant is the
one the database recorded. `POST /api/billing/plan-change/status`: empty body (or `{}`).

**Request flow.** prepare (DB) → expected provider customer read from the local subscription
(service-role, never from the browser) → provider `GET /v1/subscriptions/{id}` outside any DB
transaction → local validation (same subscription and customer, configured store, environment test mode, `active`, not
cancelled/paused/trial/ended, `renews_at` equal to the local paid period end, `payment_processor`
exactly `stripe`) → `request_billing_plan_change_v1` with the state token and the validated
evidence (the DB re-checks customer, from-variant and versions) → **one** `PATCH`
`{variant_id, disable_prorations: true}` (never `invoice_immediately`) → `record` → sanitized view.
PayPal and any payment processor not positively identified as `stripe` are refused before the
intent (the provider API cannot change PayPal subscriptions). The interval is enforced by the
database mapping (only monthly Starter/Pro variants exist there).

**At most one application dispatch.** The dispatch right is the new intent id returned by the
atomic `request_billing_plan_change_v1` (subscription lock + one-unresolved-change unique index).
Only the call that receives it sends the PATCH; every other call gets `BILLING_PLAN_CHANGE_PENDING`
and answers `already_pending` without any provider mutation. No new migration was needed. There is
no automatic retry anywhere; the HTTP client uses `redirect: "error"`.

| Crash/loss window | Result |
| --- | --- |
| request RPC response lost (intent may be committed) | no id → no PATCH; `status_unknown`; a committed intent stays `requested` (blocking) |
| intent committed, process stops before the PATCH | `requested`, attempt 0, blocking; never re-dispatched; refresh cannot confirm while the provider shows the old variant; operator investigation |
| PATCH sent, process stops before `record` | same as above; a later webhook or status check may still confirm (E1) |
| `record` committed but its response lost | one in-process replay of the same result (idempotent), never a second PATCH |
| `record` never committed | `status_unknown`; the change stays `requested` (never `not_applied` or success) |
| browser aborts the request | the server flow continues; the outcome is visible through the status route |

This is not exactly-once delivery of the external HTTP request; it is at most one application
dispatch, with an explicitly unknown outcome after interruptions.

**Classification.** GET failures are only "unavailable" (nothing sent). After the dispatch:
2xx with a valid body for the same subscription, expected customer, configured store and test mode
→ `accepted`
(neither payment nor completion; it contributes E1 evidence). Everything else — timeout, transport
failure, redirect, 429, any 4xx, 5xx, invalid/foreign/oversized body (64 KiB limit), or a throwing
adapter — is `ambiguous` → `unknown`. No provider response is classified `rejected`: there is no
proven allowlist of responses that prove the change was not applied.

**Status route.** Loads the latest local change; with none, or a terminal one, it answers without a
provider call. For an unresolved change it does a validated GET (same subscription and the customer recorded with
the change; otherwise nothing is recorded), records it as `observed` and runs
`evaluate_billing_plan_change_v1`. It never sends a PATCH. A bare provider read is not E2 (047
semantics), so a status check alone never completes a change.

**Response.** `{success, outcome, doNotRepeat, planChange: {id, state, direction, targetPlan,
effectiveAt, nextAction}}` with `outcome` in `requested | already_pending | status_unknown | current
| none`; `state` in `pending_confirmation | scheduled | review_required | completed | not_applied |
abandoned` (`completed` only when the database completed the change). No provider IDs, customer,
store, tokens, raw provider data, conflict codes or URLs are returned. Errors are stable
`BILLING_PLAN_CHANGE_*` codes; `doNotRepeat` tells a later UI not to offer another change or purchase
while an outcome is pending or unknown.

**Local vs provider-confirmed.** All of the above is tested locally with a mocked provider, including
the TS core and the real Supabase repository over the real C2 RPCs on a disposable database
(`npm run test:billing-plan-change-db`). Nothing here is confirmed against Lemon Squeezy.

## Billing UI (default-off through the server flag)

Code: `src/features/billing/components/PlanChangePanel.tsx`, `hooks/usePlanChange.ts`,
`services/billingPlanChangePresentation.ts`, `services/billingPlanChangeController.ts`, server
availability `planChange/billingPlanChangeAvailability.ts` (added to `/api/billing/overview`).

**Overview authority.** `/api/billing/overview` returns `planChange: {canRequest, unavailableReason,
targetPlan, effectiveAt, canCheckStatus, current}`. It is computed with database reads only — the latest
change of the salon and the read-only `prepare_billing_plan_change_v1` for the single possible target
(Starter ↔ Pro) — so ownership, active provider-linked monthly subscription, trial/pilot/override/
cancelled/expired/past-due limits, the 48 h buffer, an unresolved change and the employee precondition
all come from the database contract. Loading the page never calls the provider, never mutates and never
creates a request. Flag/config/parity off → `unavailableReason: "disabled"`, no action and no status
check, **but an existing change is still shown** (`current`). Managers see the status read-only. No
tokens, provider IDs, customer/store data or conflict codes are returned. The UI only explains; the
endpoint and the database re-check everything.

**Offer and confirmation.** For an eligible owner the target plan card shows "Pređi na <paket> od naredne
obnove". It only opens a confirmation dialog (no request) listing: current plan, new plan with the catalog
base monthly price (no tax-inclusive or next-invoice amount is invented), the effective date, that nothing
is charged now, that the current plan stays until the renewal, that Pro starts only after a confirmed
renewal (or that new activations are limited to the Starter limit for a downgrade), that without a
confirmed renewal the account becomes read-only after the date, and that the request cannot be cancelled
or replaced. "Potvrdi promenu na <paket>" sends one POST.

**States and messages** (from the server view; the POST body is never treated as completion):

| State | Message |
| --- | --- |
| `scheduled` (confirmed) | "Prelazak na <paket> zakazan je za <datum>." (+ Pro only after a confirmed renewal / Pro stays until then) — only this state names a switch date |
| `pending_confirmation` (requested/unknown) or lost/unknown POST | "Ishod promene još nije potvrđen. Nemojte ponavljati zahtev. Proverite status." |
| `review_required` | "Promenu je potrebno proveriti. Obratite se podršci." (no automatic resolution is promised) |
| `completed` | "Prelazak na <paket> je potvrđen nakon uspešne obnove." (plan shown from canonical entitlements) |
| `not_applied` / `abandoned` | the change was not applied / not carried out because the subscription was not renewed |

Unavailable reasons are explained (48 h, surplus employees with the target limit and a link to
`/employees` — nothing is deactivated automatically, payment problem, cancelled, purchase pending,
override, unavailable). A pending downgrade shows the narrowed employee limit from the database capacity
authority on the billing and employees pages. Never shown: "payment successful" from a POST, target
capabilities before canonical confirmation, an optimistic new plan, or a generic retry after an unclear
outcome.

**Repeat protection.** One POST per confirmation (single-flight; repeated clicks are ignored). After a
lost response, a 5xx, `status_unknown` or any unrecognised answer the UI shows the do-not-repeat message,
locks new requests in this user:salon context and re-reads the local overview/entitlements only; it never
sends another change request. Error codes that the server returns only before any provider mutation
(48 h, capacity, provider read unavailable, state changed, …) show their message without the lock.

**An unclear POST is not resolved by the absence of a change.** The original request may still be running
on the server (prepare → provider GET → intent) when the browser loses the response, so an overview read
can show "no change, requestable" before the intent is committed. The lock is therefore released only when
a later local overview read (the request's own refresh, a B2 refresh or an explicit status check) shows a
concrete transition whose id differs from the change known when the request was sent; no timeout is used
to "prove" failure. A pending transition keeps the offer hidden anyway; its state is shown from the server
view (requested → pending, confirmed → scheduled). After a full reload the lock is gone (it is in-memory
only) and the page trusts the server overview. This is not exactly-once protection: the database stays
the authority — a second request while the first intent exists gets `BILLING_PLAN_CHANGE_PENDING`, and
only the caller that received the new intent id dispatches the PATCH.

**Local refresh vs provider status check.** Focus/visibility/pageshow refreshes (B2) re-read only the
local overview and entitlements; their fingerprint now includes the plan-change state. The explicit
"Proveri promenu" button (shown only when `canCheckStatus`) calls `/api/billing/plan-change/status`
(provider read + evaluation, never a PATCH), then re-reads overview and entitlements. No polling.
Single-flight per action; results after logout, user/salon change or unmount are dropped; a failed check
keeps the last valid data and says the data may be stale. If the flag is switched off while a change is
pending, the status stays visible from the database but neither action is offered; the browser cannot
bypass the server flag.

**Tested locally (not provider-confirmed).** Unit/controller tests, plus real components and hooks in
headless Chrome over an isolated `next dev` (every `.env.local` value overridden with inert values, all
`/api/*` and Supabase calls answered by CDP mocks before navigation, every external request blocked),
desktop and a 390×844 mobile viewport, including the lost-response race (an overview read before the late
commit does not re-offer the change; the late requested and then confirmed state is shown; exactly one
plan-change POST; local refreshes never call the status endpoint). This does not prove server
authorization, the real database, the provider or webhook processing.

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
4. Operator recovery is minimal (migration `202610220048`, runbook section 13): `record_observed`
   (E1 from a validated provider read) and `resolve_not_applied` (renewal on the previous plan with a
   paid renewal invoice). Same-timestamp E1 conflicts, post-boundary-only target reads and an
   unresolved dispatch while the provider still shows the previous plan stay unsupported by design.
5. Remote migration, flag and provider configuration per environment, then live acceptance, as
   separate steps.

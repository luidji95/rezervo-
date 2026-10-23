# E1: resubscribe after a verified terminal expiry

Migration: `supabase/migrations/202610230049_e1_resubscribe_after_expiry.sql`.

Status: **local database, server, UI and operator compatibility, default-off.** Nothing here is
applied remotely or confirmed against Lemon Squeezy. All provider behaviour in the tests is
simulated through the real ingest/processor/recovery RPCs or a local mock provider. The sandbox API
key was not used. Billing and live release are not complete.

## Product contract

- The owner of a salon whose previous provider subscription is **verifiably expired** may buy a new
  Starter or Pro monthly subscription. Salon data is kept. No new trial (internal or provider) is
  granted; a provider trial on the new subscription is refused by the created processor.
- The target employee limit must already be met before the provider checkout is created
  (`EMPLOYEE_OVER_TARGET_LIMIT`). The owner can deactivate employees while read-only. Nothing is
  deactivated automatically.
- Access returns only when a verified `subscription_created` for the new checkout is processed.
  A return from the provider page never grants anything.

Not a resubscribe (refused, existing path kept):

| State | Result | Path |
| --- | --- | --- |
| `cancelled`, paid period still running | `BILLING_SUBSCRIPTION_ALREADY_ACTIVE` / reason `cancelled_until_period_end` | resume through the existing portal/management path |
| `cancelled`, period end passed, no expired evidence yet | `BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED` / `terminal_state_unconfirmed` | wait for the signed `expired` event, or D snapshot recovery (below) |
| `past_due` (local mapping of provider `past_due` and `unpaid`) | `BILLING_SUBSCRIPTION_PAYMENT_REQUIRED` / `payment_recovery` | payment recovery (portal) |
| `active`, `trialing` | `BILLING_SUBSCRIPTION_ALREADY_ACTIVE` | — |
| active billing override (pilot) | `BILLING_OVERRIDE_ACTIVE` / `override_active` | E2 |
| provider-free (internal trial, legacy active, pilot) | `not_applicable` | initial purchase / E2 |
| unresolved C2 plan change (`requested`/`unknown`/`confirmed`/`manual_review`) | `BILLING_RESUBSCRIBE_PLAN_CHANGE_UNRESOLVED` | C2 operator recovery; an un-confirmed change is abandoned by the existing evaluator when the expiry is applied |
| durable possible purchase (see below) | `BILLING_PURCHASE_ACTIVATION_PENDING` | C1/D |
| identity/binding ambiguity | `BILLING_RECONCILIATION_REQUIRED` | operator investigation |

### Provider status semantics (official documentation, checked 2026-10-23)

- `expired`: the subscription has ended; it is "no longer resumable" (managing-subscriptions guide);
  customers should no longer have access (subscription object). `ends_at` is set for `cancelled`
  and `expired`.
- `cancelled`: still valid in the grace period; can be resumed with `cancelled: false` until
  `ends_at`, then becomes `expired`.
- `unpaid`: after four failed retries; depending on the store's recovery setting it is either
  cancelled automatically (then expires) or **stays `unpaid` and the customer can reactivate it at
  any time**. It is therefore never treated as terminal here.
- The documentation does not say whether a new checkout reuses the previous customer id. The
  contract does not require it (see identity).

## Terminal evidence

A local period end in the past is not evidence. `private.billing_resubscribe_terminal_reason_v1`
requires a provider-linked row in the database runtime environment with `status = 'expired'`,
`current_period_ends_at <= now` and one of:

1. the row's `provider_last_webhook_event_id` is a processed, signed `subscription_updated` whose facts
   show `expired` for the same provider subscription and customer at exactly the row's
   `provider_state_updated_at`; or
2. an applied D `subscription_snapshot` recovery for the same subscription and provider id whose
   applied status is `expired` at exactly the row's `provider_state_updated_at` (the existing D
   snapshot path: provider GET outside any transaction, review token, re-check under the
   subscription lock).

Both writers already validate `ends_at <= now` and `ends_at <= updated_at` for `expired`. Because
`expired` is not resumable, no fresh provider read is needed once this evidence exists; the
acquisition re-checks the local state under its locks, so a state that moved after the overview read
(override, plan change, new event) is refused.

## Identity model (previous / current)

- `subscriptions` remains **the single current row per salon**; every existing reader and writer
  keeps its cardinality rule.
- `billing_subscription_provider_generations` (append-only, immutable, RLS on, service-role
  `select` only, never returned to browsers) keeps every superseded identity: provider subscription
  and customer id, plan, final status, periods, `provider_state_updated_at`, last event, and what
  superseded it (new provider id, checkout, created event). Unique per
  `(provider, environment, provider_subscription_id)`, per `(subscription_id, generation)` and per
  checkout.
- Current generation = 1 + number of history rows. Review fingerprints
  (`private.billing_subscription_state_fingerprint_v1`) include it, so D snapshot and event
  reprocess tokens issued before a replacement are stale afterwards (they also see the new provider
  id).
- A resubscribe intent is bound at acquisition to the provider subscription id and generation that
  were current and terminal (`billing_checkout_sessions.resubscribe_from_provider_subscription_id`,
  `resubscribe_from_generation`; check constraint, immutable by trigger). Initial purchases keep
  both null.
- The new provider subscription becomes authoritative only through the created processor (below).
  Its customer id is taken from the verified created event correlated to the checkout (checkout
  session id, salon, idempotency key, environment, store/product/variant mapping); it may equal or
  differ from the previous customer.

## Acquisition (`acquire_billing_checkout_intent_v3`)

`v3(..., p_allow_resubscribe)` is v2 plus the resubscribe branch; v2 is now a SQL wrapper calling v3
with `false`, so there is one implementation. Same locks: intent advisory → checkout rows →
subscription → plan → employee-capacity advisory. For `expired` with the flag on it requires the
terminal evidence above, a Starter/Pro active target plan, and `private.billing_resubscribe_acquisition_reason_v1`:

- no active override;
- no C1 pending activation (`resolve_billing_purchase_activation_v1`);
- no signed `subscription_created`/`subscription_updated` for this salon (custom data) in
  `received`/`manual_review` whose provider subscription is neither the current nor a superseded
  identity — it may be an unactivated purchase;
- no `completed` resubscribe checkout bound to the current identity (completed ambiguity);
- no `creating`/`open` checkout of another kind or generation.

Then the existing C1 capacity precondition, expired-open replacement, insert-or-existing with the
active-intent unique index. An existing intent is resumed only for the same kind and generation
(`BILLING_RECONCILIATION_REQUIRED_CHECKOUT_BINDING` otherwise). The TS core is unchanged: creating
recovery, open resume and the token-authoritative finalizer apply as for the first purchase. No
subscription is created or changed at acquisition. Two parallel requests give one `created` and one
`existing` with the same id (tested).

## Activation (`process_billing_subscription_created_v2`)

New narrow branch for a resubscribe checkout that is not completed and whose provider subscription
differs from the current one:

1. the current row must still be exactly the bound identity and generation, otherwise
   `processor_resubscribe_generation_conflict` (manual review, nothing changes) — a second purchase
   never replaces an already activated new subscription;
2. the bound identity must still be terminal (`processor_resubscribe_previous_not_terminal`);
3. existing checks unchanged: correlation, plan/mapping, provider state (`active`, no trial/pause,
   `renews_at` in the future), no other row with the new provider id, order not used by another
   checkout, checkout `open` (an `expired` checkout parks as `processor_checkout_state_invalid`);
4. ordering is per identity: the new subscription's `updated_at` is never compared with the
   superseded identity's timestamp (avoids `stale_ignored` swallowing a paid activation);
5. final capacity check under the capacity lock (`processor_checkout_capacity_exceeded` parks);
6. atomically: history row, current row switched to the new identity/plan/period (cancellation
   flags cleared, trial fields untouched and unused), checkout `completed`, event processed. The
   pending-checkout capacity reservation ends with the checkout and the new plan limit applies.

The same event again is `already_processed`; a new delivery of the same facts is idempotent; a
different provider subscription for the completed checkout is `processor_provider_ownership_conflict`.

## Late events of the superseded identity

| Writer | Behaviour |
| --- | --- |
| updated processor (webhook, retry worker, D reprocess) | provider id found in history → `processed`, outcome `stale_ignored`, `last_processing_outcome = 'superseded_identity_ignored'`, regardless of `updated_at` |
| created processor | same, checked before any checkout or subscription read |
| invoice ingest | unchanged: evidence is recorded under its own provider subscription id; the renewal evaluator only runs for the current identity; C1 `payment_confirmed` and C2 E3 match by provider subscription id, so an old invoice is never new payment evidence (tested) |
| D snapshot plan/apply | identity check against the current row; old evidence is `identity_conflict`; old tokens stale |
| D event reprocess | created parked for capacity/expired checkout of a resubscribe is eligible only for its own still-current terminal generation (`recovery_resubscribe_generation_conflict` otherwise); completed checkouts of earlier generations do not compete |
| C2 request/evaluate/operator | eligibility needs the current active identity; terminal changes are immutable; the overview/status `latestChange` now reads only changes of the current provider subscription |
| read-only reconciliation | unchanged (reads the current provider id) |

## Failed or ambiguous purchase

- Provider rejection before a URL: existing `failed`; nothing granted.
- Link expired: the existing expired replacement may open a new intent **for the same generation**.
  This does not conclude that the old one was unpaid: if it was paid, its created event parks
  (`processor_checkout_state_invalid`) and blocks every further purchase until an operator resolves
  it; if the replacement activated first, the old one is a generation conflict (manual review).
  Residual risk, same as the first purchase: a payment started on the old link just before its
  provider expiry and a second payment on the replacement can both succeed (double charge →
  operator refund outside Rezervo).
- `creating` with a lost provider response: existing creating recovery.
- Any failed/unknown purchase keeps the previous identity and history untouched and grants nothing.

## Operator boundaries

Supported: D snapshot to record a provider `expired` state (terminal evidence); D event reprocess of
a parked resubscribe activation for its own generation after the owner reduced employees. Not
supported: manual creation of the new identity, force-replacement, rewriting history, releasing a
pending activation, provider refunds/cancellations from Rezervo. See the runbook, section 14.

## Rollout

- Server flag `BILLING_RESUBSCRIBE_ENABLED === "true"` (test) / `BILLING_LIVE_RESUBSCRIBE_ENABLED`
  (live), resolved with the checkout config; it requires the checkout capability and config, the
  live allowlist for live, and environment parity. Not set anywhere. Without it v3 behaves exactly
  as v2 and the overview reports `resubscribe.state = "disabled"` for an expired owner.
- Activation of an already issued resubscribe checkout does not depend on the flag.
- `/api/billing/overview` returns `resubscribe: {state, reason}` (codes only). `canStartCheckout`
  is true for an eligible owner. Database reads only (`resolve_billing_resubscribe_eligibility_v1`).
- UI: explanation lines for eligible/disabled/blocked states, the existing plan buttons for the
  purchase, no optimistic access, no trial wording.

## Tested locally (disposable PostgreSQL, mocked provider)

- `npm run test:billing-e1-resubscribe-db` — happy path, flag off, binding immutability, idempotent
  and conflicting created deliveries, late old updated/created/invoice, cancelled/past_due/override/
  trial/legacy refusals, C2 requested (abandoned) vs manual_review, D snapshot as evidence, capacity
  refusal/parking/D activation, expired replacement + late paid old intent + generation conflict,
  foreign provider event, completed ambiguity, stale overview read, store/tenant/trial/ownership
  mismatches, old tokens, old invoice not E3 for a new change.
- `npm run test:billing-e1-resubscribe-concurrency` — parallel acquisitions; activation vs a newer
  old-identity update in both orders; activation vs a new request in both orders.
- `npm run test:billing-e1-resubscribe-ts-db` — TS checkout core + mock provider over the real v3
  RPC, overview eligibility, C2 `latestChange` scoping, DB/TS access parity before/after activation.
- `npm run test:billing-e1-resubscribe` — config gate, availability presentation, parser, repository
  shape.
- Browser (isolated harness outside the repository, real components/hooks, mocked backend/auth,
  external requests blocked): eligible expired, server refusal, cancelled before expiry, unconfirmed
  expiry, pending activation, unresolved plan change, flag off, confirmed new activation; desktop and
  390×844.

## Provider / remote acceptance still required

1. Sandbox: an `expired` subscription followed by a new checkout — order and content of
   `subscription_created`, `subscription_updated` and `subscription_payment_success` for the new
   subscription; whether the customer id is reused; whether late events of the old subscription
   still arrive.
2. Confirm that the store's recovery setting leads unpaid subscriptions to `expired` (otherwise they
   stay in payment recovery and never become resubscribe-eligible).
3. Remote migration history (044–049), flag and provider configuration per environment, then live
   acceptance — separate, approved steps.

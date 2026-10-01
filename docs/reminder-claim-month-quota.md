# Pilot reminder quota decision

SMS reminder allowances use the salon's local calendar month, independently of
subscription billing dates. `reminder_usage_period` returns the half-open interval
from local month-start to the next local month-start using `salons.timezone`
(existing empty/null fallback: `Europe/Belgrade`). Each boundary is converted to
`timestamptz` separately, including its DST offset.

At the FIRST successful claim, `appointment_reminder_deliveries.quota_period_start`
stores the start of that claim's month and becomes immutable. Accepted usage and processing reservations
are attributed to this same key. `scheduled_for` and `sent_at` do not select the
quota month. Provider acceptance still requires both `sent_at` and
`provider_message_id`; later delivery failure does not refund accepted usage.

A live claim obtained before midnight remains in its original month when sent
after midnight. Pre-send validation checks the stored month, while access and
effective-plan limits are revalidated at the actual send time. Accepted and
reserved counts use one SQL snapshot so concurrent finalization cannot hide a
slot between two counts. Existing per-salon advisory locks serialize claims.

A failed attempt is not accepted usage. Retry scheduling releases its processing
reservation. Retry/reclaim obtains a new lease/token but retains the first-claim
month, and checks accepted + reserved capacity in that original month. `claimed_at`
still records the last lease attempt. Finalization/recovery with an old token
remains rejected. Cancellation and failure retain the quota key as audit evidence.
A database trigger rejects changing or clearing an established key with
`REMINDER_QUOTA_PERIOD_IMMUTABLE`.

Migration 043 backfills only historical rows with exactly one documented attempt,
non-null `claimed_at`, and a timezone snapshot present in `pg_timezone_names`.
Multiple attempts cannot prove the first claim from the last `claimed_at`.
Relevant rows include all attempt/claim evidence, processing, retry_scheduled,
sent/delivered and provider-acceptance evidence, including terminal audit rows.
Ambiguous/missing first-claim evidence stops the transaction with
`REMINDER_QUOTA_FIRST_CLAIM_UNPROVEN`; missing/invalid timezone evidence stops it
with `REMINDER_QUOTA_TIMEZONE_EVIDENCE_INVALID`. Both require operator review;
neither sent/scheduled/created timestamps nor a default timezone substitute for
historical evidence. No operator policy is inferred automatically.

The CHECK requires a key and claim evidence for every claimed row, including
retry_scheduled and provider-accepted rows. Unclaimed pending/failed/cancelled
rows need no key. Retry/finalization/recovery do not clear it, and the trigger also
prevents a direct update from rewriting an established key.

The allowance is not prorated. Purchase/renewal does not reset it; local month-start
does. Trial, paid access and overrides retain their existing eligibility rules.
Changing salon timezone can change which stored month key a subsequent usage
query selects; existing delivery keys are not rewritten. The current salon settings
gateway does not expose timezone editing. Previously quota-skipped deliveries are
not automatically replayed.

B11a invoice evidence remains part of the pilot. B11b0 was preserved locally on
`archive/b11b0-renewal-calendar` at `c0653f8`; renewal-calendar pairing (B11b1/B11b2)
is outside pilot scope. Subscription start/end persistence, billing processors,
entitlement/environment checks, checkout and reconciliation retain their committed
behavior. This decision does not remove the subscription period integrity checks.

Verification: `npm run test:reminder-claim-quota-db` creates a disposable PostgreSQL
container and checks calendar/DST boundaries, claim/send month separation,
retry/recovery, migration backfill, service-only ACLs, concurrent quota enforcement,
and existing gateway/B11a contracts. It does not call a provider or a deployed DB.

`node scripts/test-provider-active-period-migration-failure.mjs` now owns a
disposable full-chain database. It reproduces the old runner's setup failure
(029 already rejects its malformed row), tests preflight rollback in a transaction,
and runs the effective 038 environment-authority contract. There is no package/CI
entry to remove. The separate historical SQL fixture
`billing_provider_active_period_contract.sql` retains pre-038 legacy-access
expectations and is not a current full-chain suite; migration 029 is unchanged.

# Lemon Squeezy sandbox foundation (Phase 7B.1)

Status: sandbox checkout and signed webhook lifecycle are confirmed; v2 processors and a dormant live checkout foundation exist; live checkout remains disabled
Official API contract checked: 2026-07-27

This document began as the historical Phase 7B.1 foundation record. Historical acceptance observations are retained below and explicitly labelled; current repository state supersedes the original statements about missing webhook synchronization, empty sandbox data, and absent checkout UI. The next production blocker is environment-isolated live retry/recovery.

## Scope and safety boundary

The original Phase 7B.1 scope created only a test checkout URL for an owner-authorized Starter or Pro intent. Creating or returning a checkout still never changes `subscriptions`, plans, billing overrides, trial dates, provider metadata or effective access; a signed webhook and its v2 processor own lifecycle synchronization. A return URL remains UX only.

Current code has separate test/live webhook routes, v2 environment-aware processors, Customer Portal support behind its disabled flag, and dormant live checkout support. Premium/yearly checkout, refund/chargeback automation, upgrade, downgrade, and live retry/recovery remain unsupported. The sandbox Billing UI can expose its test checkout CTA through the existing Preview flag; no live CTA exists. Every checkout endpoint remains unavailable unless its server runtime gates are explicitly enabled.

## Verified Lemon Squeezy contract

Official sources: [API requests](https://docs.lemonsqueezy.com/api/getting-started/requests), [create checkout](https://docs.lemonsqueezy.com/api/checkouts/create-checkout), [checkout object](https://docs.lemonsqueezy.com/api/checkouts/the-checkout-object), [taking payments](https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments), and [currencies](https://docs.lemonsqueezy.com/help/payments/currencies).

- Base URL is `https://api.lemonsqueezy.com`; checkout creation is `POST /v1/checkouts`.
- Requests use JSON:API headers and `Authorization: Bearer <server-only API key>`.
- Store and variant are JSON:API relationships. Product contains variants; the selected subscription variant owns the recurring price.
- `checkout_data.custom` is returned later in webhook `meta.custom_data`. New checkouts send the database-generated checkout-session ID as the primary correlation key, plus salon ID, plan code and local idempotency key for validation and diagnostics.
- `product_options.redirect_url` is the documented post-success destination. The API does not document a distinct cancel URL for created hosted checkouts; the neutral adapter retains `cancelUrl` for provider portability but Lemon Squeezy does not send it.
- `expires_at` is explicit and may otherwise be null. Rezervo requests a 30-minute expiry.
- Response `data.id` is the provider checkout/session ID and `data.attributes.url` is the temporary checkout URL. A test request sends and requires `test_mode=true`; a live request sends and requires `test_mode=false`.
- Test and live API keys/objects are separate. The trusted environment comes from server deployment configuration, never from browser input or the provider response. Live support remains dormant behind its separate capability, credentials, and pilot allowlist.
- The API documents no checkout idempotency header. Rezervo therefore provides DB idempotency; a timeout remains `creating`/reconciliation-required rather than blindly creating a second checkout.
- Lemon Squeezy supports RSD presentation but processes transactions in USD. The adapter never sends `custom_price`; the configured provider variant is the charged-amount authority, while the local mapping must equal the Rezervo RSD catalogue.

## Provider adapter

`BillingProvider` has one method only: `createCheckoutSession`. Its neutral input contains salon/actor, Starter or Pro, monthly interval, local idempotency key, canonical success/cancel URLs, optional server-derived email, trusted billing environment, server-derived store/variant IDs and requested expiry. Its sanitized output contains provider, provider session ID, checkout URL, expiry and the same trusted environment.

`LemonSqueezyBillingProvider` is server-only and uses typed `fetch`, a 10-second timeout, no cache and JSON:API. It validates numeric store/variant IDs, never accepts price/currency from the request, never sends `custom_price`, requires an HTTPS response URL and sanitizes every provider error. A definite HTTP 4xx rejection is failed; 5xx, timeout, network uncertainty, and every malformed or mode-mismatched 2xx response remain reconciliation-required. It never logs the key or raw response.

`MockBillingProvider` produces a deterministic provider ID/URL and supports success, rejection, unavailable and timeout/reconciliation outcomes. Unit tests never contact Lemon Squeezy.

## Environment and feature gate

Future values must be server-scoped except the existing canonical public app URL:

```text
BILLING_CHECKOUT_ENABLED=false
BILLING_PROVIDER=lemonsqueezy
BILLING_ENVIRONMENT=test
LEMONSQUEEZY_API_KEY=<test key, server only>
LEMONSQUEEZY_STORE_ID=<test store ID, server only>
LEMONSQUEEZY_WEBHOOK_SECRET=<test webhook signing secret, server only>
BILLING_LIVE_WEBHOOKS_ENABLED=false
LEMONSQUEEZY_LIVE_WEBHOOK_SECRET=<live webhook signing secret, server only>
NEXT_PUBLIC_APP_URL=https://rezervo-app-gamma.vercel.app
```

Both checkout capabilities default closed. The endpoint returns a sanitized disabled/not-configured error before provider or DB work when the environment-specific flag, deployment authority, provider credentials, numeric Store ID, canonical URL, or required live pilot allowlist is invalid. A production build exposes no live CTA in this phase. Do not create `NEXT_PUBLIC_` provider variables.

## Dormant live checkout foundation

The server checkout core supports a trusted `live` billing environment, but live checkout remains disabled by default. Production requires the separate `BILLING_LIVE_CHECKOUT_ENABLED=true` capability, dedicated live provider credentials, an HTTPS application URL, and a non-empty server-only `BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS` pilot allowlist. Test and live flags or credentials never fall back across environments.

The browser cannot select the billing environment or alter the pilot allowlist. A non-allowlisted live salon is rejected before mapping lookup, checkout-ledger insertion, or provider access. `NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED` remains the Preview/test UI control; this foundation does not expose a live CTA. No live mapping, credential, or salon UUID belongs in the repository. A real live checkout remains prohibited until the separate live retry/recovery phase is complete and accepted.

Authenticated Vercel admin access is still required to prove the canonical project and set Preview/test-scoped secrets. Do not set these values on both duplicate projects. Recommended dashboard sequence:

1. confirm which project owns `rezervo-app-gamma.vercel.app` and its `main`/Supabase production contract;
2. add test-only provider/key/store variables to a controlled Preview or operator test deployment;
3. leave Production `BILLING_CHECKOUT_ENABLED` absent/false;
4. keep preview protection enabled and perform no live provider setup;
5. resolve old aliases before any live-mode phase.

## Database foundation

Migration `202607270017_billing_sandbox_foundation.sql` adds two server-only tables.

`billing_provider_prices` stores plan, provider/environment, monthly currency/amount and provider product/variant IDs. Unique contracts cover one mapping per provider/environment/plan/interval/currency and one variant per provider/environment. A validation trigger accepts only active Starter/Pro and requires exact `monthly_price` and currency parity. Migration 017 itself seeded no mapping; controlled sandbox mappings were added later outside that historical migration.

`billing_checkout_sessions` stores salon/actor/requested plan, provider/environment, idempotency key, provider session ID, state, SHA-256 URL hash, expiry/timestamps and sanitized error code. It never stores the checkout URL. States are `creating`, `open`, `completed`, `expired`, `failed`, and `cancelled`; 7B.1 uses creating/open/failed/expired. `completed` is not subscription authority.

Later phases extended this ledger with nullable `provider_order_id` and `resulting_subscription_id`, and added `subscriptions.billing_environment`. Every new checkout is inserted first and its database-generated `billing_checkout_sessions.id` is sent as `meta.custom_data.checkout_session_id`. Signed webhook ingestion and v2 processors now use the verified correlation to complete checkout and subscription lifecycle state. Older checkout URLs without this field must never be auto-linked using only salon ID, plan code, approximate time, or another weak heuristic.

Both tables have RLS enabled and no anon/authenticated policies or privileges. `service_role` has table CRUD. Provider/session identifiers and internal actor/error data are available only through server code.

## Mapping runbook

Use `supabase/snippets/billing_sandbox_price_mapping.sql` with explicit psql variables. It selects plans only by slug, rejects Premium, yearly, non-RSD, mismatched amount, unsupported provider/environment, duplicate active mappings and unconfirmed live mappings. It ends in `ROLLBACK`; an operator must review output and consciously replace it with `COMMIT` for an approved test operation.

Expected test mappings are Starter/monthly/RSD/2990 and Pro/monthly/RSD/5990. Product ID may be absent; variant ID is mandatory. Never commit the supplied IDs.

## Checkout endpoint and authorization

`POST /api/billing/checkout` accepts strictly:

```json
{ "salonId": "uuid", "planCode": "starter|pro", "idempotencyKey": "optional uuid" }
```

Unknown fields—including environment, amount, currency, provider/variant, actor, success/cancel URL—cause `INVALID_INPUT`. The server validates bearer auth, derives actor/email, requires exact `salons.owner_id`, blocks manager/employee/cross-tenant access, blocks every active override, loads the monthly mapping for the trusted environment, and verifies active plan, Store ID, RSD, and amount equality.

The success destination is `/settings?tab=billing&checkout=return`; the neutral cancel destination is `/settings?tab=billing&checkout=cancelled`. Neither changes access. The sandbox UI can display “Test naplata” and “Proveravamo stanje uplate” when its Preview flag is enabled; no live checkout CTA is implemented.

## Idempotency and timeout

The unique `(provider, environment, idempotency_key)` ledger contract serializes retries across instances. Flow: insert `creating`; a race reloads the existing row; a complete valid provider success stores ID/hash/expiry and marks `open`; a definite HTTP 4xx rejection marks `failed`. Every ambiguous POST result—5xx, timeout, network failure, malformed 2xx JSON, invalid/missing checkout identity or URL, non-HTTPS URL, or mode mismatch—leaves the ledger `creating` and returns `BILLING_RECONCILIATION_REQUIRED`, because Lemon Squeezy may already have created the checkout. Failure to persist a valid provider result through the environment-scoped `markOpen` update follows the same reconciliation-required contract. A repeated idempotency key cannot create another provider checkout while that attempt remains unresolved.

A valid recent open session for the same salon/plan returns `BILLING_CHECKOUT_IN_PROGRESS`; its URL cannot be replayed because URLs are not stored and the minimal checkout adapter intentionally has no retrieve method. An expired open row is marked expired and a new key may create a new attempt. The later read-only reconciliation system audits linked subscriptions; unresolved checkout creation still requires its explicit operator recovery contract.

## Error contract

Public codes are `BILLING_NOT_CONFIGURED`, `BILLING_CHECKOUT_DISABLED`, `BILLING_OWNER_REQUIRED`, `BILLING_PLAN_NOT_AVAILABLE`, `BILLING_OVERRIDE_ACTIVE`, `BILLING_PRICE_MAPPING_MISSING`, `BILLING_PRICE_MISMATCH`, `BILLING_CHECKOUT_IN_PROGRESS`, `BILLING_PROVIDER_UNAVAILABLE`, `BILLING_PROVIDER_REJECTED`, `BILLING_RECONCILIATION_REQUIRED`, `INVALID_INPUT`, and `FORBIDDEN`. Raw provider responses, IDs, SQLSTATE, constraints, keys and stack traces are never returned.

## Historical RSD and eligibility preflight

At the time of Phase 7B.1, no Lemon Squeezy test account, test API key, Store ID, or Starter/Pro test variants were supplied to the implementation environment. The remote checkout and visual RSD proof described in this historical subsection had therefore not yet run; later sandbox checkout and webhook lifecycle acceptance superseded that original execution status. Production approval is still not claimed here.

Before 7B.2, an explicitly authorized operator must verify separately for Starter and Pro: test-mode marker, Rezervo SaaS/store identity, locale/payment methods, 2990/5990 RSD subtotal, tax and total, absence of unexpected USD/FX price, RSD-denominated provider subscription renewal, and dashboard variant currency. If either price is unstable or displayed in USD, stop and revisit the provider decision without changing the Rezervo catalogue.

## Historical sandbox acceptance result (Phase 7B.1A)

Acceptance preflight was repeated on 2026-07-27. No Lemon Squeezy test API key, test Store ID, Starter/Pro test product or variant identifiers, or authenticated Lemon Squeezy/Vercel operator session was available to the execution environment. Only variable presence was inspected; no value was printed or persisted.

- Store/KYC status: **status could not be verified**.
- Test-object assurance: not available; no remote request was made with an unknown or potentially live object.
- Starter checkout proof: not executed; currency, subtotal, tax, total, interval, locale, payment methods, test marker and merchant identity remain unverified.
- Pro checkout proof: not executed; the same fields remain unverified.
- RSD and renewal result: unverified. A checkout URL alone would not satisfy acceptance.
- Provider idempotency and invalid-variant checks: remote checks not executed; local DB concurrency, mock rejection and reconciliation tests pass.
- Return URL authority: application and lifecycle tests confirm that return/cancel query parameters perform no subscription mutation, but no provider success return was generated.
- Production safety state at the time of this historical acceptance: migration history ended at `202607270017`; provider mappings and checkout sessions were empty; plan, subscription and override fingerprints were unchanged; the public endpoint returned `BILLING_CHECKOUT_DISABLED`. This is not the current sandbox state.

That historical Lemon Squeezy recommendation was conditional. The sandbox checkout and webhook lifecycle were subsequently confirmed, while secrets and identifiers remain prohibited from chat and committed files.

## Current next phase

Raw-body signature verification, explicit test/live webhook routing, the webhook event ledger, and environment-aware v2 subscription processors now exist. Checkout return parameters remain non-authoritative. Live checkout stays disabled until environment-isolated live retry/recovery is implemented and accepted; reconciliation, Customer Portal activation, and public live UI remain separate later gates.

# Lemon Squeezy sandbox foundation (Phase 7B.1)

Status: local/disposable implementation; checkout synchronization is not implemented
Official API contract checked: 2026-07-27

## Scope and safety boundary

This phase creates only a test checkout URL for an owner-authorized Starter or Pro intent. Creating or returning a checkout never changes `subscriptions`, plans, billing overrides, trial dates, provider metadata or effective access. A return URL is UX only. Verified webhook lifecycle synchronization belongs to Phase 7B.2.

There is no live mode, Premium/yearly mapping, customer portal, cancellation, refund, chargeback, upgrade or downgrade implementation. The public Billing UI has no checkout CTA. The endpoint is unavailable unless every runtime gate is explicitly enabled.

## Verified Lemon Squeezy contract

Official sources: [API requests](https://docs.lemonsqueezy.com/api/getting-started/requests), [create checkout](https://docs.lemonsqueezy.com/api/checkouts/create-checkout), [checkout object](https://docs.lemonsqueezy.com/api/checkouts/the-checkout-object), [taking payments](https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments), and [currencies](https://docs.lemonsqueezy.com/help/payments/currencies).

- Base URL is `https://api.lemonsqueezy.com`; checkout creation is `POST /v1/checkouts`.
- Requests use JSON:API headers and `Authorization: Bearer <server-only API key>`.
- Store and variant are JSON:API relationships. Product contains variants; the selected subscription variant owns the recurring price.
- `checkout_data.custom` is returned later in webhook `meta.custom_data`. Rezervo sends only salon ID, plan code and local idempotency key.
- `product_options.redirect_url` is the documented post-success destination. The API does not document a distinct cancel URL for created hosted checkouts; the neutral adapter retains `cancelUrl` for provider portability but Lemon Squeezy does not send it.
- `expires_at` is explicit and may otherwise be null. Rezervo requests a 30-minute expiry.
- Response `data.id` is the provider checkout/session ID and `data.attributes.url` is the temporary checkout URL. `attributes.test_mode` must be true.
- Test and live API keys/objects are separate. This adapter rejects any environment except `test` and sends `test_mode: true`.
- The API documents no checkout idempotency header. Rezervo therefore provides DB idempotency; a timeout remains `creating`/reconciliation-required rather than blindly creating a second checkout.
- Lemon Squeezy supports RSD presentation but processes transactions in USD. The adapter never sends `custom_price`; the configured provider variant is the charged-amount authority, while the local mapping must equal the Rezervo RSD catalogue.

## Provider adapter

`BillingProvider` has one method only: `createCheckoutSession`. Its neutral input contains salon/actor, Starter or Pro, monthly interval, local idempotency key, canonical success/cancel URLs, optional server-derived email, test environment, server-derived store/variant IDs and requested expiry. Its sanitized output contains provider, provider session ID, checkout URL, expiry and test environment.

`LemonSqueezyBillingProvider` is server-only and uses typed `fetch`, a 10-second timeout, no cache and JSON:API. It validates numeric store/variant IDs, never accepts price/currency from the request, never sends `custom_price`, requires an HTTPS response URL and sanitizes 4xx, 5xx, malformed response and timeout errors. Definite 4xx rejection is failed; ambiguous 5xx or timeout remains reconciliation-required. It never logs the key or raw response.

`MockBillingProvider` produces a deterministic provider ID/URL and supports success, rejection, unavailable and timeout/reconciliation outcomes. Unit tests never contact Lemon Squeezy.

## Environment and feature gate

Future values must be server-scoped except the existing canonical public app URL:

```text
BILLING_CHECKOUT_ENABLED=false
BILLING_PROVIDER=lemonsqueezy
BILLING_ENVIRONMENT=test
LEMONSQUEEZY_API_KEY=<test key, server only>
LEMONSQUEEZY_STORE_ID=<test store ID, server only>
LEMONSQUEEZY_WEBHOOK_SECRET=<reserved for 7B.2, unused>
NEXT_PUBLIC_APP_URL=https://rezervo-app-gamma.vercel.app
```

`BILLING_CHECKOUT_ENABLED` defaults closed. The endpoint returns a sanitized disabled/not-configured error before provider or DB work when the flag, provider, test environment, key, numeric store ID or canonical URL is invalid. A production build does not need sandbox credentials and exposes no active CTA. Do not create `NEXT_PUBLIC_` provider variables.

Authenticated Vercel admin access is still required to prove the canonical project and set Preview/test-scoped secrets. Do not set these values on both duplicate projects. Recommended dashboard sequence:

1. confirm which project owns `rezervo-app-gamma.vercel.app` and its `main`/Supabase production contract;
2. add test-only provider/key/store variables to a controlled Preview or operator test deployment;
3. leave Production `BILLING_CHECKOUT_ENABLED` absent/false;
4. keep preview protection enabled and perform no live provider setup;
5. resolve old aliases before any live-mode phase.

## Database foundation

Migration `202607270017_billing_sandbox_foundation.sql` adds two server-only tables.

`billing_provider_prices` stores plan, provider/environment, monthly currency/amount and provider product/variant IDs. Unique contracts cover one mapping per provider/environment/plan/interval/currency and one variant per provider/environment. A validation trigger accepts only active Starter/Pro and requires exact `monthly_price` and currency parity. No mapping is seeded.

`billing_checkout_sessions` stores salon/actor/requested plan, provider/environment, idempotency key, provider session ID, state, SHA-256 URL hash, expiry/timestamps and sanitized error code. It never stores the checkout URL. States are `creating`, `open`, `completed`, `expired`, `failed`, and `cancelled`; 7B.1 uses creating/open/failed/expired. `completed` is not subscription authority.

Both tables have RLS enabled and no anon/authenticated policies or privileges. `service_role` has table CRUD. Provider/session identifiers and internal actor/error data are available only through server code.

## Mapping runbook

Use `supabase/snippets/billing_sandbox_price_mapping.sql` with explicit psql variables. It selects plans only by slug, rejects Premium, yearly, non-RSD, mismatched amount, unsupported provider/environment, duplicate active mappings and unconfirmed live mappings. It ends in `ROLLBACK`; an operator must review output and consciously replace it with `COMMIT` for an approved test operation.

Expected test mappings are Starter/monthly/RSD/2990 and Pro/monthly/RSD/5990. Product ID may be absent; variant ID is mandatory. Never commit the supplied IDs.

## Checkout endpoint and authorization

`POST /api/billing/checkout` accepts strictly:

```json
{ "salonId": "uuid", "planCode": "starter|pro", "idempotencyKey": "optional uuid" }
```

Unknown fields—including amount, currency, provider/variant, actor, success/cancel URL—cause `INVALID_INPUT`. The server validates bearer auth, derives actor/email, requires exact `salons.owner_id`, blocks manager/employee/cross-tenant access, blocks every active override, loads only test monthly mapping and verifies active plan, RSD and amount equality.

The success destination is `/settings?tab=billing&checkout=return`; the neutral cancel destination is `/settings?tab=billing&checkout=cancelled`. Neither changes access. A future operator-only test UI may say “Test naplata” and “Proveravamo stanje uplate,” but no UI is exposed in this phase.

## Idempotency and timeout

The unique `(provider, environment, idempotency_key)` ledger contract serializes retries across instances. Flow: insert `creating`; a race reloads the existing row; provider success stores ID/hash/expiry and marks `open`; a definite rejection marks `failed`; an ambiguous 5xx or timeout leaves `creating` and returns `BILLING_RECONCILIATION_REQUIRED` because Lemon Squeezy may have created the checkout.

A valid recent open session for the same salon/plan returns `BILLING_CHECKOUT_IN_PROGRESS`; its URL cannot be replayed because URLs are not stored and the minimal adapter intentionally has no retrieve method. An expired open row is marked expired and a new key may create a new attempt. Phase 7B.2 may add safe provider reconciliation/retrieval.

## Error contract

Public codes are `BILLING_NOT_CONFIGURED`, `BILLING_CHECKOUT_DISABLED`, `BILLING_OWNER_REQUIRED`, `BILLING_PLAN_NOT_AVAILABLE`, `BILLING_OVERRIDE_ACTIVE`, `BILLING_PRICE_MAPPING_MISSING`, `BILLING_PRICE_MISMATCH`, `BILLING_CHECKOUT_IN_PROGRESS`, `BILLING_PROVIDER_UNAVAILABLE`, `BILLING_PROVIDER_REJECTED`, `BILLING_RECONCILIATION_REQUIRED`, `INVALID_INPUT`, and `FORBIDDEN`. Raw provider responses, IDs, SQLSTATE, constraints, keys and stack traces are never returned.

## RSD and eligibility proof still required

No Lemon Squeezy test account, test API key, Store ID or Starter/Pro test variants were supplied for this implementation. Store approval/KYC status is unknown; production approval is not claimed. Remote checkout creation and visual RSD proof were therefore not run.

Before 7B.2, an explicitly authorized operator must verify separately for Starter and Pro: test-mode marker, Rezervo SaaS/store identity, locale/payment methods, 2990/5990 RSD subtotal, tax and total, absence of unexpected USD/FX price, RSD-denominated provider subscription renewal, and dashboard variant currency. If either price is unstable or displayed in USD, stop and revisit the provider decision without changing the Rezervo catalogue.

## Next phase

Phase 7B.2 owns raw-body signature verification, test/live event isolation, webhook event ledger, idempotent lifecycle reconciliation and any subscription mutation. Checkout return parameters remain non-authoritative. No webhook endpoint or synchronization exists in 7B.1.

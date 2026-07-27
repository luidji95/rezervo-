# Billing provider and lifecycle decision (Phase 7B.0)

Status: architecture decision, no payment implementation  
Research checked: 2026-07-27  
Scope: monthly Starter and Pro subscriptions for Serbian salons; Premium and annual billing remain unavailable.

## 1. Executive decision

Rezervo should use a **Merchant of Record (MoR) for the MVP**, conditionally selecting **Lemon Squeezy** as the primary provider. Lemon Squeezy explicitly lists Serbia for merchant bank payouts, accepts SaaS after store/KYC review, supports subscriptions, trials, a hosted portal, signed webhooks and RSD as a selling/display currency. Its important caveat is that it processes transactions in USD and converts at a live mid-market rate. Before sandbox implementation is promoted toward live mode, the operator must prove with a Serbian-issued card that a fixed `2990 RSD`/`5990 RSD` recurring price is presented and charged without customer-visible price drift, and obtain written confirmation that the intended Serbian business entity and Rezervo SaaS are eligible.

The operational fallback is a **direct local acquirer, initially Banca Intesa e-commerce**. Its official product page explicitly advertises recurring payments, card-on-file, 3-D Secure, hosted processor entry, refunds and a test server for Serbian merchants. A commercial/technical proposal must still confirm exact RSD charging and settlement, merchant fees, server notifications, token lifecycle and recurring MIT rules. This fallback is the strongest candidate for exact domestic RSD pricing, but makes Rezervo the seller responsible for invoicing, Serbian tax/fiscal obligations, refunds and billing operations.

**Paddle** is the alternate MoR only if the business approves a future EUR price catalogue: Serbia is not on Paddle's unsupported-seller list, but RSD is absent from its supported payment currencies and payouts are limited to USD/EUR/GBP/AUD/CAD. **Stripe direct** is rejected for the current Serbian entity because Serbia is absent from Stripe's merchant availability list; Stripe Atlas or a foreign entity is not a payment integration shortcut. **PayPal Business standalone** is rejected as the primary billing rail: Serbian receiving/withdrawal and subscription APIs exist, but RSD is not a supported subscription currency, PayPal is not the MoR, and Rezervo would retain tax/invoice responsibilities.

This is a conditional provider recommendation, not approval or legal advice. No live integration may begin until provider onboarding, accountant review and the canonical-domain release gate are complete. A Lemon Squeezy sandbox foundation may begin after the operator creates/authorizes a test account; no production approval is required for sandbox work.

## 2. Existing Rezervo billing contract

`public.plans` is the canonical feature and price catalogue. Stable identifiers are `starter`, `pro`, and `premium`; current monthly prices are 2990/5990/17990 RSD, yearly prices are null, employee limits are 3/10/25, and Premium is inactive. Premium booleans are development/presentation data and do not make it purchasable.

`public.subscriptions` already has one row per salon and contains:

- `id`, `salon_id`, `plan_id`, `status`;
- nullable `billing_provider`, `provider_customer_id`, `provider_subscription_id`;
- `trial_starts_at`, `trial_ends_at`;
- `current_period_starts_at`, `current_period_ends_at`;
- `cancel_at_period_end`, `cancelled_at`;
- `created_at`, `updated_at`.

The `subscriptions_provider_metadata_consistent` constraint permits provider-null rows only when both provider identifiers are null. It also permits a known provider/customer before a provider subscription exists. It must remain; future schema should strengthen uniqueness of non-null provider customer/subscription identifiers without creating another subscription table.

The salon trigger creates exactly one 14-day Pro trial with all provider metadata null. `create_primary_salon_once_v1()` is idempotent. A trial is internal state, not a provider trial.

`resolve_salon_access_v1()` and the TypeScript `resolveSubscriptionAccess()` derive access at request time:

| Local state | Current access |
| --- | --- |
| valid `trialing` | full Pro until strict `trial_ends_at > now()` |
| valid `active` period | full plan access |
| `active` without period | temporary full `legacy_active_no_period` compatibility |
| `cancelled` with future period end | full until period end |
| `past_due`, `expired`, ended/invalid period | read-only |
| active billing override | full override plan, higher priority than subscription |

The Billing Overview route uses the existing bearer-auth server contract, verifies owner/manager tenant access, resolves entitlements and returns a sanitized plan catalogue. Future billing mutations must be owner-only even though managers may currently read billing information. Settings Billing and the global banner are informational; there is no checkout, payment method or cancellation operation.

`public.billing_access_overrides` is service-role only, RLS-protected, and supports `internal`, `pilot`, `complimentary`, and `support`. It never mutates the underlying subscription.

## 3. Official provider research

All facts below were checked on 2026-07-27. “Supported buyer country” and “supported Serbian merchant payout” are deliberately separate.

### Lemon Squeezy (MoR)

- Serbia is explicitly listed for bank payouts and merchants may also use a verified PayPal account. Bank payouts originate in USD and may be converted to the selected bank currency; PayPal payouts are USD. Payouts are created twice monthly, net sales are held 13 days, and the minimum payout is USD 50. [Supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries), [getting paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid)
- Lemon Squeezy is MoR, calculates/remits applicable sales tax/VAT and issues customer order invoices/receipts. Rezervo receives net payout and a reverse payout invoice, but a Serbian accountant must classify that income and any local reporting obligation. [Sales tax and VAT](https://docs.lemonsqueezy.com/help/payments/sales-tax-vat)
- SaaS/subscription stores are normally allowed but every store undergoes questionnaire, KYC/KYB, identity and product review; approval is not guaranteed. [Store activation](https://docs.lemonsqueezy.com/help/getting-started/activate-your-store), [identity verification](https://docs.lemonsqueezy.com/help/getting-started/verify-your-identity)
- Standard fee is 5% + USD 0.50, with published additions including 1.5% international, 1.5% PayPal and 0.5% subscriptions. Non-US bank payout is 1%; non-US PayPal payout is 3% capped at USD 30. Custom pricing is advised for sub-USD-10/high-volume products. [Fees](https://docs.lemonsqueezy.com/help/getting-started/fees)
- RSD is a supported store/selling currency and appears in checkout/receipts, but all transactions are processed in USD using a real-time mid-market conversion. Payouts originate in USD. This prevents an architecture-only guarantee that a buyer's card statement is exactly 2990/5990 RSD. [Currencies](https://docs.lemonsqueezy.com/help/payments/currencies)
- Flat monthly subscriptions, optional provider trials, retries/dunning, cancellation to period end, expiration, prorations, refunds, test mode and signed webhooks are supported. Rezervo should not create a second provider trial. [Subscriptions](https://docs.lemonsqueezy.com/help/products/subscriptions), [test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode), [webhook events](https://docs.lemonsqueezy.com/help/webhooks/event-types)
- The hosted portal can expose payment method, invoices, pause, cancellation, resume and product changes. Rezervo must disable/avoid portal plan changes that bypass Premium, downgrade-at-period-end or employee-limit rules. [Customer portal](https://docs.lemonsqueezy.com/help/online-store/customer-portal)
- Refund policy is seller-configurable, but Lemon Squeezy may refund within 60 days; chargebacks generally deduct transaction value plus a USD 15 dispute fee. Excess chargebacks can suspend a store. [Refunds and chargebacks](https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks)

### Paddle Billing (MoR)

- Paddle states it supports software sellers worldwide except its explicit unsupported-country list; Serbia is not on that list. Final account, identity and domain review remains mandatory. [Seller countries](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle), [account verification](https://www.paddle.com/help/start/account-verification), [domain review](https://www.paddle.com/help/start/account-verification/what-is-domain-verification)
- Paddle is MoR and includes payments, subscription billing, tax compliance, fraud/chargeback handling, customer support and revenue recovery. Standard checkout pricing is 5% + USD 0.50; products under USD 10 should request custom pricing. [Pricing](https://www.paddle.com/pricing)
- Paddle supports checkout, subscriptions, trials, proration, 3DS2, refunds, chargebacks, dunning/Retain, a customer portal, webhooks and sandbox. [Checkout](https://developer.paddle.com/concepts/sell/self-serve-checkout/), [cards](https://developer.paddle.com/concepts/payment-methods/card/), [concepts](https://developer.paddle.com/concepts/)
- RSD is not in Paddle's current supported payment currency list. Payout balances/currencies are USD, EUR, GBP, AUD or CAD. Payouts are monthly, created above a USD/EUR/GBP 100 minimum on the first and sent by the fifteenth, by wire or Payoneer; possible SWIFT/bank fees apply. [Currencies](https://developer.paddle.com/concepts/sell/supported-currencies/), [payouts](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid)
- A chargeback is against Paddle as MoR, but transaction value and a card USD/EUR/GBP 15 or PayPal 20 fee are deducted from seller balance unless reversed. [Chargebacks](https://www.paddle.com/help/manage/risk-prevention/understanding-chargebacks-with-paddle)

### Stripe direct

- Stripe's global merchant-availability list does not include Serbia. Accepting payments from Serbian buyers or Stripe Tax coverage in Serbia does not mean a Serbian company can open a standard Stripe merchant account. [Global availability](https://stripe.com/global)
- Stripe offers strong subscription, trials, portal, dunning, webhook, sandbox and RSD presentment capabilities in supported merchant countries, but using Atlas/another foreign entity would change Rezervo's legal, tax and payout structure. [Currencies](https://docs.stripe.com/currencies), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [testing](https://docs.stripe.com/billing/testing)
- Therefore it is rejected for the current entity. Reconsider only after Stripe officially lists Serbia or Rezervo independently establishes an appropriate supported entity after legal/accounting review.

### PayPal Business direct

- PayPal's Serbian business surface advertises receiving global payments and recurring payments; Serbian balances can be withdrawn to eligible banks/cards, with market-specific withdrawal and FX fees. [PayPal Serbia Business](https://www.paypal.com/rs/business), [Serbia withdrawal information](https://www.paypal.com/rs/digital-wallet/paypal-consumer-fees), [merchant fees](https://www.paypal.com/rs/business/paypal-business-fees)
- Subscriptions, free/discounted trials, automatic retries, suspension, sandbox, refunds and lifecycle webhooks exist. [Recurring payments](https://www.paypal.com/us/business/accept-payments/recurring-payments), [Subscriptions API](https://developer.paypal.com/docs/api/subscriptions/v1/), [subscription webhooks](https://developer.paypal.com/subscriptions/webhooks), [sandbox testing](https://developer.paypal.com/docs/subscriptions/test-subscriptions/)
- RSD is not documented as a PayPal subscription currency. PayPal is a PSP, not Rezervo's MoR; Rezervo remains seller/invoice/tax operator. Card availability and advanced checkout eligibility can differ by market and account approval. It is useful as a future payment method, not the primary lifecycle platform.

### Serbian local acquirers/gateways

- Banca Intesa officially offers recurring payments for subscriptions, card-on-file token storage, hosted processor entry, 3-D Secure, refunds, technical documentation, test cards and a test authorization server to Serbian legal entities/entrepreneurs. Commercial pricing and server-notification specifics are not public. [Banca Intesa e-commerce](https://www.bancaintesa.rs/en/privreda/prihvatanje-platnih-kartica/e-commerce.html)
- Raiffeisen officially offers merchant e-commerce for Visa/Mastercard/DinaCard plus Apple Pay/Google Pay and advertises no initial implementation fee and a promotional six months without monthly rent. Its public materials do not confirm a production recurring/tokenization API contract; that must be obtained in writing. [Raiffeisen e-commerce](https://www.raiffeisenbank.rs/sr/privreda/prihvatanje-platnih-kartica/e-commerce.html)
- No public official evidence sufficient for a production decision was found for Monri/AllSecure recurring pricing and Serbian settlement. They remain request-for-proposal candidates, not assumed capabilities.
- With every local acquirer Rezervo is the merchant, owns customer invoicing/refunds/tax treatment, negotiates merchant fees and settlement, and must implement more of the subscription/dunning/portal layer itself. A payment link alone is not subscription billing.

## 4. Weighted decision matrix

Scores are 0 (unavailable/unknown) to 5 (excellent). Weighted total is out of 500. Availability or a critical currency failure cannot be compensated only by SDK quality.

| Criterion | Weight | Lemon | Paddle | Banca Intesa | PayPal | Stripe RS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Serbian merchant eligibility/approval confidence | 12 | 4 | 3 | 5 | 3 | 0 |
| Recurring subscriptions and trial fit | 9 | 5 | 5 | 3 | 4 | 0 |
| Hosted checkout, 3DS/SCA, PCI reduction | 6 | 5 | 5 | 4 | 4 | 0 |
| Exact RSD checkout | 10 | 3 | 0 | 3 | 0 | 0 |
| Serbian payout/settlement fit | 8 | 4 | 3 | 4 | 3 | 0 |
| Total cost at Rezervo price points | 7 | 2 | 2 | 3 | 3 | 0 |
| Tax/VAT and invoicing burden | 10 | 5 | 5 | 1 | 1 | 0 |
| Portal, cancellation, plan changes | 5 | 4 | 5 | 1 | 3 | 0 |
| Dunning/refund/chargeback operations | 6 | 4 | 5 | 2 | 3 | 0 |
| Webhook/API/sandbox quality | 8 | 4 | 5 | 2 | 4 | 0 |
| Next.js/Supabase integration fit | 4 | 4 | 4 | 3 | 3 | 0 |
| UX for a Serbian salon | 7 | 4 | 2 | 5 | 2 | 0 |
| Portability/vendor lock-in | 4 | 3 | 3 | 3 | 3 | 0 |
| Public evidence completeness | 4 | 5 | 5 | 2 | 3 | 5 |
| **Weighted total / 500** | **100** | **401** | **356** | **304** | **266** | **20** |

Rationale: Lemon wins on confirmed Serbian payout, MoR responsibilities and end-to-end subscription tooling, with a material RSD-processing caveat and relatively high fee. Paddle is technically excellent but fails current RSD pricing. Banca Intesa gives the best domestic currency/acquiring fit but needs a commercial API review and creates the largest accounting/application burden. PayPal has market and currency friction and is not MoR. Stripe's current merchant-country failure is decisive.

Decision-change conditions:

1. If Lemon rejects the entity/product or cannot demonstrate stable customer-facing RSD recurring charges, request a Banca Intesa recurring proposal and make local acquiring primary.
2. If the business approves EUR prices and Paddle approves the entity/domain with acceptable payout terms, Paddle becomes the preferred MoR fallback.
3. If Stripe officially launches standard Serbian merchant accounts, rescore it; do not use Atlas solely to bypass availability.
4. If accountant/legal advice requires Rezervo to be the direct Serbian seller or MoR receipts do not satisfy customer/accounting needs, choose local acquiring despite engineering cost.

## 5. Currency, payout and accounting decision

- Keep `public.plans` in RSD. Do not invent annual or EUR prices.
- Configure Lemon Squeezy RSD variants at exactly 2990 and 5990 RSD in sandbox. Treat Premium as unmapped.
- Do not promise an exact card debit until sandbox/card-statement evidence confirms the provider's USD processing does not introduce customer-visible variance. If it does, Lemon is not suitable for the current price promise.
- Expected Lemon payout is USD-originated; select a Serbian business bank payout currency only after the bank/accountant confirms whether USD, EUR or converted RSD is operationally preferable and records all FX/payout fees. Do not describe payout as native RSD settlement.
- Under MoR, Lemon Squeezy is seller to the buyer and supplies the order invoice/receipt and applicable indirect-tax handling. Rezervo records the net/gross settlement and payout documentation. A Serbian accountant must confirm income recognition, corporate tax, VAT treatment of the MoR relationship, foreign-service documentation, foreign-currency account requirements and whether any local e-invoice/fiscalization obligation remains.
- Under local acquiring, Rezervo is seller, charges/settles RSD under the bank contract, issues the legally required invoice/fiscal document and owns VAT/tax/refund compliance.

## 6. Canonical billing lifecycle

### Internal trial

The current 14-day Pro trial remains entirely internal: `billing_provider`, customer ID and provider subscription ID are null. Checkout does not recreate or extend it.

MVP decision: checkout during or after trial **starts paid service immediately after authoritative successful payment**. The user must see that any unused trial time ends when payment succeeds. Scheduling first billing at the internal trial end would duplicate trial clocks across systems, add card-consent edge cases and complicate reconciliation.

### Checkout started

1. Bearer-auth endpoint derives the profile from the token; only the salon owner is allowed.
2. Server verifies the requested salon belongs to that owner, has no conflicting provider subscription and has no blocking override.
3. Client sends only salon ID and `starter|pro`; the server loads active plan and provider-price mapping and ignores client amount/currency/price IDs.
4. Premium, annual intervals, cross-tenant IDs, managers and employees are rejected.
5. Server creates/reuses an idempotent checkout attempt keyed by salon, requested plan, provider environment and a bounded attempt key. Suggested hosted session lifetime is provider default capped operationally at 30 minutes; the stored `expires_at` is authoritative for UI reuse.
6. Closing checkout changes nothing. Multiple clicks reuse the non-expired attempt; a different requested plan expires the old pending attempt before opening another. Existing provider subscriptions send the owner to portal/Billing instead.
7. Success/cancel URLs use only the canonical application URL. Return URL displays “processing” and polls local Billing Overview; it never activates access.

### Checkout completed and active

- Signed provider webhook is the only payment-state authority. For Lemon Squeezy, `subscription_created` plus successful initial payment/order evidence is reconciled to the checkout custom salon ID and mapped variant.
- In one database transaction, lock the salon subscription, verify provider/environment/price mapping, upsert provider customer/subscription IDs, set plan/status/period from provider data, mark checkout completed and event processed.
- A non-null provider subscription ID is unique per provider/environment. One salon has one local subscription; conflicting second provider subscriptions go to manual review instead of overwriting.
- `active` requires confirmed successful payment and a valid `current_period_ends_at`. Entitlements refresh from the local subscription after commit.
- Each renewal success advances `current_period_starts_at/ends_at` monotonically. Duplicate events are no-ops.

### Failed payment and recovery

- Provider dunning may retry, but local `past_due` remains immediately read-only as the current contract requires. There is no undocumented grace period.
- A later verified recovery/success event, reconciled against current provider state when needed, restores `active` and the new period.
- Exhausted retries map to provider terminal state (`expired` locally, or `cancelled` once its paid period has ended). Operator messaging must distinguish payment update from checkout.

### Cancellation and expiration

- MVP cancellation is `cancel_at_period_end`, not immediate. Local state keeps access through strict `current_period_ends_at > now()` and presents cancellation scheduled.
- Reactivation before the period end clears the provider and local cancel-at-end flag only after a verified provider event/state fetch.
- When the provider confirms termination, local status becomes `cancelled`; the existing resolver keeps access only while the period end is future. After the boundary it is read-only. A later reconciliation job may normalize ended rows to `expired`, but access must not depend on that job.
- Immediate cancellation is an operator-only exceptional action; it must explicitly decide refund and access end instead of silently combining them.

### Refund and chargeback

- A full or partial refund is a financial event, not automatically a subscription cancellation. Store a minimal payment/refund summary or link and preserve access unless the provider subscription also terminates or an operator applies an explicit fraud decision.
- A full initial-payment refund normally triggers operator review and explicit cancellation; partial renewal refunds do not alter plan/access by themselves.
- Chargeback/reversal immediately sets a `manual_review` operational flag in the event/payment read model and alerts an operator. Do not map every dispute event blindly to `expired`: fetch provider subscription/payment state, then an operator decides suspend/cancel/access. The existing resolver has no `manual_review` status, so until a future explicit status decision the handler must avoid destructive overwrites.

## 7. Plan changes

- **Starter → Pro:** owner-requested immediate upgrade. Provider must successfully collect the immediate prorated difference (or approved full new-period charge) before the webhook switches local plan and Pro capabilities. Recommended MVP is provider proration with immediate invoice; failure leaves Starter unchanged. Return URL is not authority.
- **Pro → Starter:** schedule at period end with no refund/proration. Pro features remain through the paid period. On the effective webhook, switch `plan_id` to Starter.
- If the salon has eight active employees at downgrade, keep all employees/data active, mark it over the limit, and block new employee insert/reactivation until active count is at most three. Never auto-disable employees.
- Premium has no live provider mapping and is rejected by checkout, portal and change-plan APIs.
- Restrict provider portal product switching unless it can enforce these exact rules. Prefer Rezervo owner-only server APIs for plan changes; portal may handle payment method, receipts, cancellation and reactivation.

## 8. Provider-neutral adapter boundary

The future server-only interface is conceptual, not implemented in this phase:

```ts
interface BillingProvider {
  createCheckoutSession(input: CheckoutInput): Promise<CheckoutSessionResult>;
  createCustomerPortalSession(input: PortalInput): Promise<PortalResult>;
  cancelSubscription(input: CancelInput): Promise<void>;
  resumeSubscription(input: ResumeInput): Promise<void>;
  changePlan(input: ChangePlanInput): Promise<void>;
  verifyWebhook(input: RawWebhookInput): VerifiedWebhookEvent;
  fetchSubscription(input: FetchSubscriptionInput): Promise<ProviderSubscriptionSnapshot>;
}
```

Neutral inputs contain internal salon/plan IDs, actor, environment, idempotency key and canonical return paths. They never contain browser-provided prices. Neutral outputs contain provider IDs, expiry, URL and normalized lifecycle snapshots.

Provider adapters own API paths, signature algorithms, raw event names/statuses, portal limitations and event-to-snapshot conversion. A central billing application service owns authorization, mapping lookup, idempotency, database transactions, monotonic ordering and entitlements. Provider event names never leak into `resolve_salon_access_v1()`.

## 9. Minimal future schema

No schema is changed in 7B.0. A later reviewed migration should consider:

### `billing_provider_prices`

- `id`, `plan_id`, `provider`, `provider_product_id`, `provider_price_id`;
- `billing_interval` constrained initially to `month`;
- `currency`, `amount`, `active`, `environment` (`test|live`), timestamps;
- unique `(provider, environment, provider_price_id)` and one active mapping per `(plan_id, provider, environment, interval, currency)`.

There is no Premium live mapping. Provider IDs never enter frontend bundles or client request authority.

### `billing_webhook_events`

- provider, environment, provider event ID/type/created time;
- received/processed timestamps, processing status/attempts, error code;
- payload SHA-256, extracted customer/subscription/price IDs and safe diagnostic metadata;
- unique `(provider, environment, provider_event_id)`.

Do not retain raw payload by default. If incident requirements demand it, encrypt it, set a retention period and exclude payment method/PII fields not needed for reconciliation.

### `billing_checkout_sessions`

Recommended because it supplies duplicate-click control, pending Billing UI, actor audit and secure salon correlation:

- salon ID, actor profile ID, requested plan ID, provider/environment;
- provider session ID, status, idempotency key, expires/created/completed timestamps;
- unique provider session and unique `(provider, environment, idempotency_key)`.

It is not a second subscription source of truth and may be retention-pruned.

### Existing subscription additions

Existing columns are otherwise sufficient. Add only provider/environment-aware uniqueness and ordering fields such as `billing_environment`, `provider_state_updated_at`, and `provider_last_event_created_at`. Consider `provider_cancel_scheduled_at` only if `cancel_at_period_end` plus period end is insufficient for UI. Do not add copied product price or entitlement booleans.

### Financial read models

Do not clone the provider ledger. For MVP, keep provider transaction/invoice ID, status, currency, gross amount, refund summary and hosted receipt/invoice URL only if Billing UI or support needs them. Provider portal remains the detailed invoice/payment source. Add dedicated immutable `billing_transactions` only when refund support and reconciliation requirements justify it.

## 10. Source of truth and webhook processing

- `public.plans`: Rezervo feature/price catalogue.
- provider-price mapping: link between a Rezervo plan and provider product/variant.
- provider API/webhook: payment truth.
- `public.subscriptions`: local materialized billing/access state.
- DB/TypeScript access resolver: effective authorization truth.
- checkout return URL: UX only.
- Billing UI: sanitized local contract, never raw provider claims.

Future endpoint: `/api/webhooks/billing/lemonsqueezy` (or provider slug).

Processing contract:

1. Read raw bytes, select secret by provider and environment, verify constant-time signature before JSON parsing.
2. Reject test/live mismatch and unknown provider; never use a user Supabase session.
3. Insert event ledger using the unique provider/event key. A duplicate already processed returns provider-success; a failed duplicate re-enters a bounded retry path.
4. Validate event type and extracted IDs, then process using service role inside a database transaction.
5. Lock subscription/checkout rows, map price server-side, enforce salon/provider uniqueness and apply only monotonic state.
6. Mark processed or persist a sanitized error/manual-review code. Return the status expected by provider retry contract; do not acknowledge before durable ledger insertion.

Lemon Squeezy signs raw bodies with HMAC-SHA256 in `X-Signature`; it expects HTTP 200 and retries failed deliveries up to three times with exponential delays. [Signing requests](https://docs.lemonsqueezy.com/help/webhooks/signing-requests), [webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests)

Ordering rules:

- Compare provider event-created timestamp and provider subscription `updated_at`/version where available.
- Payment-success events can advance a period only, never shorten it.
- An older failure/cancel event cannot overwrite a newer paid/active snapshot.
- Use the event alone when IDs, mapping, version and transition are unambiguous.
- Fetch current provider subscription for stale/out-of-order events, cancellation/resume races, unknown local status, missing period, or destructive transitions.
- Put unknown customer/subscription/price, conflicting salon correlation, environment mismatch or irreconcilable chronology into manual review. Never guess a salon by email/name.

Initial Lemon normalized mapping:

| Provider event/snapshot | Local action |
| --- | --- |
| `subscription_created` + successful initial payment | attach IDs; `active`; mapped plan/period |
| `subscription_payment_success`/`recovered` | advance period; `active` |
| `subscription_payment_failed` | `past_due` after ordering check |
| `subscription_updated` | reconcile plan, period, cancel flag and status |
| `subscription_cancelled` | `cancel_at_period_end=true`; preserve paid access |
| `subscription_resumed` | clear cancel flag after reconciliation |
| `subscription_expired` | `expired`/ended `cancelled`; read-only |
| `order_refunded`/`subscription_payment_refunded` | record finance event; no automatic access mutation |
| chargeback/reversal evidence | alert and manual reconciliation |

## 11. Checkout and endpoint security

- Existing bearer-auth server pattern is sufficient; SSR Supabase cookies are not required for sandbox billing.
- Owner only: derive user from bearer token and verify `salons.owner_id`; manager/employee are forbidden for checkout, portal plan change and cancellation.
- Accept only salon ID and Starter/Pro intent. Load amount, RSD, interval and provider price mapping server-side.
- Use stable idempotency keys and one provider subscription per salon/provider/environment.
- Success/cancel URLs come from canonical `NEXT_PUBLIC_APP_URL`, not request Host or client input.
- Provider secrets and service-role key remain server-only. Webhook authenticates with provider signature, not bearer/session.
- DB constraints/RLS and service methods remain the authorization boundary. Frontend cannot activate a subscription.

## 12. Billing UI state model (future)

| State | User message and available action |
| --- | --- |
| Trial | Pro trial and real end date; owner can choose Starter/Pro checkout |
| Checkout pending | Payment is not yet confirmed; resume/reopen unexpired session, refresh status |
| Active | Current plan/price, next renewal date, receipt/portal; owner may cancel or request change |
| Past due | Read-only now; update payment method/portal and show provider retry context |
| Cancel scheduled | Access continues to period end; owner may reactivate |
| Cancelled, period future | Same full-access end date; no “active renewal” claim |
| Expired/read-only | Data preserved; start a new Starter/Pro checkout |
| Internal/support override | Billing exempt; checkout blocked; operator contact |
| Pilot/complimentary override | Explicit policy label; checkout blocked until operator removes override |
| Provider mismatch/manual review | No destructive self-service; contact support; preserve only resolver-authorized access |

Never show a next invoice date without a verified provider period. Invoice/receipt and portal URLs must be short-lived/signed where applicable.

## 13. Overrides and legacy subscriptions

- Any active override blocks checkout and plan/cancellation actions. This includes internal, support, pilot and complimentary until product leadership explicitly chooses a different rule.
- Payment webhooks never delete, disable or shorten an override. They may synchronize the underlying subscription; override remains the access winner and an operator decides when to remove it.
- Before live checkout, classify each `legacy_active_no_period` row by explicit salon UUID as `internal`, `pilot`, `complimentary`, or future paid migration. Never infer classification from email/name.
- For future paid migration, create/attach a provider customer/subscription only through an approved operator flow, set a real period and preserve access until reconciliation completes.
- Keep `legacy_active_no_period` compatibility until all rows are classified and a separate migration/removal plan is approved.

## 14. Environment and secrets model

Future names only; no values are created here:

- `BILLING_PROVIDER=lemonsqueezy`;
- `LEMONSQUEEZY_API_KEY`;
- `LEMONSQUEEZY_WEBHOOK_SECRET`;
- `LEMONSQUEEZY_STORE_ID`;
- `NEXT_PUBLIC_APP_URL` (already the canonical URL contract).

Provider product/price IDs belong in `billing_provider_prices`, not public env or frontend code. If an initial sandbox temporarily uses env mappings, replace them before multi-plan/live rollout.

Local/preview use only test credentials and test mappings. Sandbox webhooks target an isolated database or explicitly test-only environment. Production uses separately created live credentials, live mappings and live webhook endpoint. An environment discriminator is mandatory in every mapping/event/checkout row; test events must fail closed at a live endpoint and can never mutate live subscriptions.

## 15. Observability and operator runbook

Future operational capabilities:

- dashboard/query of webhook received/processed/failed/manual-review counts without raw secrets/PII;
- bounded retry with attempt count and stable error codes;
- owner-safe provider/local mismatch audit by IDs and timestamps;
- alerts for invalid signature spikes, unknown price/customer/subscription, duplicate customers, environment mismatch and events failing after retry;
- manual reconciliation that fetches provider state and previews a local diff before applying;
- optional later daily read-only reconciliation job—no Cron is introduced in 7B.0;
- runbooks for full/partial refund, cancel-at-end, immediate fraud cancellation, payment recovery, duplicate customer merge/escalation, provider outage and secret rotation.

During provider outage, existing locally verified paid access remains until its recorded end; do not extend periods or activate pending checkouts without payment evidence.

## 16. Implementation-phase test plan

Checkout: owner Starter/Pro; manager/employee/Premium/cross-tenant forbidden; invalid/inactive mapping; duplicate clicks; internal trial; expired/read-only; existing provider subscription; every override type; canonical URL and server-owned price.

Webhook: valid/invalid signature; raw-body verification; duplicate/replayed event; out-of-order old failure after new success; unknown customer/subscription/price; initial success; renewal; failure/recovery; cancel scheduled/completed/resumed; upgrade/downgrade; refund; chargeback; test/live mismatch; durable failure and retry.

Lifecycle: trial→active; abandoned checkout; trial expiry without payment; active→past_due→active; active→cancel-at-end; scheduled cancel→resume; period end→read-only; Starter→Pro successful/failed payment; Pro→Starter at period end with eight employees; override precedence; legacy row unchanged.

Security: browser amount/currency/price ignored; return URL cannot activate; Premium unmapped; provider secret/service role absent from bundle/log; signature mandatory; timing-safe verification; owner-only billing; webhook has no user session; idempotency and provider-ID uniqueness; test cannot mutate live.

Contract tests should use provider fixtures plus sandbox end-to-end tests. Never make CI depend on live provider state or shared webhook delivery order.

## 17. Live-mode gates

These block live mode, but not an isolated provider sandbox:

1. Authenticated Vercel audit proves project/team ID, ownership of `rezervo-app-gamma.vercel.app`, production branch/env and public-production protection.
2. Old `rezervo.vercel.app` and `rezervo-app.vercel.app` aliases are removed or redirected.
3. Provider-approved domain, success/cancel URLs and webhook use only the canonical domain.
4. Lemon Squeezy entity/store/KYC approval and written Serbian payout eligibility.
5. Sandbox evidence for 2990/5990 RSD checkout, renewal, receipt and customer card debit; approved payout currency/FX accounting.
6. Serbian accountant/legal review of MoR agreement, invoice/receipt sufficiency, VAT/tax, foreign payout and refund treatment.
7. Explicit classification of both legacy active/no-period subscriptions.
8. Live products/mappings, isolated secrets, monitoring, operator runbook and a controlled authorized live transaction/refund test.

## 18. Delivery phases

- **7B.1 — provider sandbox foundation:** operator-created Lemon test account, conditional eligibility confirmation, adapter boundary, provider-price mapping, owner-only checkout session, no live mode.
- **7B.2 — webhook ledger/lifecycle:** raw signature verification, idempotent ledger, event ordering/reconciliation and sandbox lifecycle tests.
- **7B.3 — Billing UI/portal:** pending/active/past-due/cancel states, payment-method/receipt portal, cancellation/reactivation with restricted portal configuration.
- **7B.4 — production readiness:** canonical-domain cleanup, legal/accounting approval, live products/secrets, monitoring/runbooks and controlled live test.
- **7B.5 — plan changes:** paid immediate Starter→Pro, period-end Pro→Starter, employee over-limit UX and verified proration rules.

Do not combine these into one migration or deployment. Checkout, webhook code, provider SDKs, secrets, live accounts and schema changes are explicitly outside Phase 7B.0.

## 19. Operator onboarding checklist

Before confirming Lemon Squeezy as non-conditional primary:

- submit the exact Serbian legal entity type, beneficial owner/KYC documents and Rezervo public product/terms/privacy/refund pages;
- obtain store approval for salon-management SaaS, not merely country-level availability;
- confirm bank and PayPal payout methods available to that entity, payout/FX fees and usable settlement currency;
- create only test Starter/Pro monthly RSD variants and verify invoices, portal restrictions, dunning and signed webhook events;
- ask support in writing whether the buyer is charged a fixed RSD amount or a USD-converted amount and preserve the answer in the runbook;
- compare effective net proceeds at 2990 and 5990 RSD, including subscription, international and payout fees;
- obtain accountant approval before live onboarding.

If any critical item fails, start the Banca Intesa recurring RFP: exact RSD settlement, cards/wallets, MIT/recurring consent, network tokens/card updater, 3DS initial/CIT flow, notification signatures/retries, refunds/chargebacks, test environment, PCI SAQ scope, setup/monthly/transaction fees and settlement timing.

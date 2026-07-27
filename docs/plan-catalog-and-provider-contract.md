# Plan catalog and billing provider contract

## Canonical catalog

The application identifies plans by the stable slugs `starter`, `pro`, and
`premium`. Names are presentation data and are not business identifiers.

| Plan | Monthly price | Yearly price | Currency | Employees | Publicly available |
| --- | ---: | ---: | --- | ---: | --- |
| Starter | 2,990 | not defined | RSD | 3 | yes |
| Pro | 5,990 | not defined | RSD | 10 | yes |
| Premium | 17,990 | not defined | RSD | 25 | no |

`yearly_price` remains `null` until an annual price and discount are approved.
`plans.is_active` controls public availability, not an existing subscription or
an explicit billing override. Premium therefore remains available to an
explicit internal override while it is hidden from public purchase.

The Phase 4 migration deliberately leaves Pro and Premium
`max_monthly_reminders` unchanged. The current counter measures
provider-accepted messages, while a future commercial model still needs to
decide between messages, SMS segments, credits, or a mixed allowance model.

Prices, currency, employee limits, and public availability are loaded by the
server billing overview from `public.plans`. TypeScript presentation data only
contains marketing descriptions and feature labels. `formatPlanPrice()` is the
single UI formatter and safely accepts PostgreSQL numeric values represented as
either strings or numbers.

## Neutral provider metadata

`subscriptions.billing_provider = null` means no real billing provider is
attached. Trial and manually managed subscriptions use this state. A provider
is written only after a real provider relationship exists.

The database permits:

- null provider with both provider identifiers null;
- non-null provider with a customer identifier and no subscription identifier;
- non-null provider with both identifiers.

It rejects a null provider with either provider identifier. The Phase 4 cleanup
only clears the historical `stripe` marker when both identifiers are null; it
fails before mutation if any Stripe row contains a provider identifier.

Subscription plan and effective override plan are separate concepts. Billing
presentation uses the effective plan while retaining the underlying
subscription lifecycle for diagnostics. No checkout, cancellation, payment
method, or provider operation is implemented by this contract.

## Environment reconstruction

The frozen baseline and `reference_seed.sql` describe the historical cutover
state after `202607270001`, including the former EUR catalog. A new environment
must apply every post-cutover migration after the seed. After
`202607270003_normalize_plan_catalog_and_billing_provider.sql`, its final state
is the canonical RSD catalog above. Do not edit the frozen seed to make it look
like current production.

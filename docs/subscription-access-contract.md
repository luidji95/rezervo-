# Subscription access contract

Subscription status is historical billing state. Access mode is the derived,
request-time decision about whether a salon may currently use operational plan
capabilities. The application derives this state in
`resolveSubscriptionAccess()` using one injected clock value; it is not stored
in PostgreSQL.

## Lifecycle rules

| Raw status | Date rule | Access | Reason |
| --- | --- | --- | --- |
| `trialing` | `trial_ends_at > now` | full | `active_trial` |
| `trialing` | missing/invalid end | read-only | `invalid_trial_period` |
| `trialing` | end at or before now | read-only | `trial_expired` |
| `active` | `current_period_ends_at > now` | full | `active_period` |
| `active` | end at or before now | read-only | `period_expired` |
| `active` | invalid end | read-only | `invalid_period` |
| `active` | missing end | full, temporary compatibility | `legacy_active_no_period` |
| `cancelled` | period end in future | full until end | `cancelled_until_period_end` |
| `cancelled` | missing/ended period | read-only | `cancelled` |
| `past_due` | any | read-only | `past_due` |
| `expired` | any | read-only | `expired` |
| missing subscription | any | read-only | `subscription_missing` |
| missing plan | any | read-only | `plan_missing` |

All end boundaries use strict `>` comparison. Access is no longer active at the
exact expiration instant. `plans.is_active` controls catalogue availability,
not an existing subscriber's access.

## Capability layers

`planCapabilities` describe the theoretical package: feature flags and limits
remain available for billing presentation even when access is read-only.

`effectiveCapabilities` combine the plan with lifecycle access. In read-only
mode statistics, reminders, AI, integrations and the future create/public
booking flags are false. Existing flat feature fields remain temporarily as
deprecated aliases of effective capabilities; flat limit fields remain aliases
of plan limits so existing consumers never receive `undefined`.

`hasActiveAccess` and `isReadOnly` are derived exclusively from the two-valued
`accessMode`. `requiresBillingMigration` identifies the temporary legacy active
case without modifying or repeatedly logging subscription rows.

Internal billing override is intentionally not part of this contract yet.
Core appointment, client, service, employee and public-booking enforcement is
also deferred to later phases; this phase only updates modules already using
the central entitlement resolver.

## Provider-linked active period invariant

`legacy_active_no_period` remains a temporary compatibility state only for an
`active` subscription without a provider link. A provider-linked `active` row
must atomically contain provider customer/subscription identity, period start
and end, a provider state timestamp, and an end strictly later than its start.
Migration 029 validates existing rows before adding the database constraint;
it does not repair or delete data.

The following query is for an authenticated database operator only. It is
read-only, contains internal UUIDs but no customer PII, and distinguishes the
states relevant to legacy review:

```sql
select
  subscription.id as subscription_id,
  subscription.salon_id,
  case
    when subscription.status = 'active'
      and subscription.billing_provider is not null
      and (
        subscription.provider_customer_id is null
        or subscription.provider_customer_id !~ '[^[:space:]]'
        or subscription.provider_subscription_id is null
        or subscription.provider_subscription_id !~ '[^[:space:]]'
        or subscription.current_period_starts_at is null
        or subscription.current_period_ends_at is null
        or subscription.provider_state_updated_at is null
        or subscription.current_period_ends_at <= subscription.current_period_starts_at
      ) then 'provider_linked_malformed'
    when subscription.status = 'active'
      and subscription.billing_provider is null
      and subscription.current_period_ends_at is null
      then 'provider_null_legacy_active_no_period'
    when subscription.status = 'active'
      and subscription.billing_provider is not null
      then 'provider_linked_active'
    when subscription.status = 'trialing' then 'active_trial'
    else 'other'
  end as subscription_audit_class,
  exists (
    select 1
    from public.billing_access_overrides as override
    where override.salon_id = subscription.salon_id
      and override.enabled
      and override.starts_at <= pg_catalog.now()
      and (override.ends_at is null or override.ends_at > pg_catalog.now())
  ) as has_active_override
from public.subscriptions as subscription
where subscription.status in ('trialing', 'active')
order by subscription_audit_class, subscription.id;
```

An active provider-linked row with a whitespace-only provider ID remains
`provider_linked_malformed` even when `has_active_override = true`. The
override can temporarily control access, but never repairs or hides malformed
provider ownership metadata.

## First live-payment salon

The first real-payment acceptance must use a dedicated internal salon whose
subscription starts as a known trial/no-provider row. It must not reuse a salon
already linked to a test Lemon Squeezy subscription. The live provider link is
established only by the atomic `subscription_created` processor; operators do
not populate provider IDs or periods manually. Existing sandbox events and
subscription audit history for other salons are retained.

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

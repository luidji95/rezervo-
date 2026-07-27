# Billing access overrides

Billing overrides are explicit, server-only free-access grants for internal,
pilot, complimentary and support use cases. They are not subscription statuses
and never mutate the underlying subscription record.

## Precedence and lifecycle

After authenticating the request and authorizing the requested salon, the
central entitlement resolver reads the server-only override. Precedence is:

1. enabled override with `starts_at <= now` and no end or `ends_at > now`;
2. normal subscription access contract;
3. fail-closed missing subscription/plan behavior.

An active override supplies the effective plan and capabilities, sets
`accessSource=billing_override`, `accessReason=billing_override` and
`isBillingExempt=true`, while preserving the underlying raw subscription status
and subscription plan code. `plans.is_active` is intentionally ignored for an
explicit grant, allowing controlled Premium development access.

Disabled, future and expired rows fall back to subscription access. The exact
end instant is inactive. A missing plan fails closed; the database foreign key
also prevents deleting an assigned plan.

## Security

`public.billing_access_overrides` has RLS enabled and no browser policies.
`PUBLIC`, `anon` and `authenticated` have all table privileges explicitly
revoked. Only `service_role` and PostgreSQL administration can read or mutate
rows. The salon-facing resolver selects neither the internal `reason` nor
`created_by_profile_id`, and it queries by salon UUID only after tenant
authorization.

Supported types:

- `internal`: Rezervo-owned development/test salon;
- `pilot`: explicitly approved early customer access;
- `complimentary`: intentionally free commercial access;
- `support`: temporary troubleshooting/support access.

## Operations

Use [billing_access_override_operations.sql](../supabase/snippets/billing_access_override_operations.sql)
with an explicit salon UUID and plan slug. The create/update and disable
examples run inside a transaction and end in `ROLLBACK`. A production change
requires separate review and consciously replacing that final statement with
`COMMIT`.

Never identify an override target by email, salon name, fuzzy matching or row
order. The runbook returns only IDs, type, plan and lifecycle timestamps; it
does not output personal data or secrets.

The aggregate read-only audit is
[billing_access_override_audit.sql](../supabase/snippets/billing_access_override_audit.sql).
It reports only the number of legacy active subscriptions without a period and
the number of currently active overrides.

No override is seeded by the migration. Until every legacy subscription is
explicitly classified, `legacy_active_no_period` remains enabled. Once all
legacy rows are covered by an override or future real billing record, a later
phase can remove that compatibility rule.

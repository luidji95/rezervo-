# Employee capacity contract

Every active row in `public.employees` consumes one plan slot. Memberships and
profiles without an active employee row consume no slot. Linking a profile to
an already-active row does not change capacity.

The database is authoritative. `resolve_employee_capacity_v1()` selects an
active billing override first and otherwise evaluates the subscription using
the same strict trial, period, cancelled, read-only, and temporary legacy-active
rules as the TypeScript access contract. `plans.is_active` does not invalidate
an assigned plan. Missing subscription or plan fails closed.

`enforce_employee_capacity_v1` runs before every active INSERT and every
inactive-to-active UPDATE, including writes made by service role. It obtains a
transaction-level advisory lock derived from the fixed
`rezervo:employee-capacity:` namespace and salon UUID, then recalculates access
and active count. This serializes competing requests for the final slot.
Existing over-limit rows are retained; another insert/reactivation is rejected
until the active count falls below the plan limit.

Supported mutations are:

- `create_employee_with_entitlement` for creation;
- `update_employee_details_v1` for safe profile and visibility fields;
- `set_employee_active_state` for activation/deactivation;
- `delete_employee_safely_v1` for history-aware soft/hard removal;
- `link_current_owner_employee_v1` for owner profile linking.

All verify `auth.uid()` and owner/active-manager scope. Browser roles retain
tenant/public SELECT only and have no table INSERT, UPDATE, or DELETE grant.
Invitation acceptance remains service-managed: it links `profile_id` on an
already-active row, so the capacity trigger correctly does not run.

Stable errors are `EMPLOYEE_ACCESS_REQUIRED`, `EMPLOYEE_LIMIT_REACHED`, and
`EMPLOYEE_ENTITLEMENT_NOT_CONFIGURED`. When access becomes read-only, existing
employees remain readable and editable through safe details, deactivation is
allowed, while creation and reactivation are blocked.

Operators can run `pnpm employee-capacity:audit` with the linked project ref.
It reports only aggregate active/inactive, relation, missing-contract, at-limit,
and over-limit counts plus policy/grant metadata; it emits no employee PII.

## C1: capacity during the first purchase after the trial

Migration `202610180046_c1_trial_purchase_employee_capacity.sql`.

**Effective limit.** `resolve_employee_capacity_v2()` is the single database authority. It
returns the plan or override limit (`plan_max_employees`), the effective limit for new
activations (`max_employees`) and `capacity_reason` (`plan`, `override`, `pending_checkout`).
A checkout in status `creating` or `open` for a plan with a lower employee limit narrows the
effective limit to that target limit. Status decides, not `expires_at`: those are exactly the
checkouts the created processor can still activate (directly, or after recovery finalization).
The narrowing applies even when an override grants a wider limit; the override still decides
access and every other capability, and a pending Starter purchase never turns a Pro trial into
Starter before activation. `enforce_employee_capacity_v1` (insert and reactivation trigger) uses
v2 and raises `EMPLOYEE_PURCHASE_LIMIT_PENDING` when the pending checkout is the binding limit,
otherwise `EMPLOYEE_LIMIT_REACHED`. `/api/entitlements` attaches `employeeCapacity` (and
`purchaseActivation`) from the database; the employees page and billing page display that limit.
If the RPC is unavailable the UI falls back to the plan limit for display only; the trigger keeps
enforcing.

**Reservation lifecycle.**

| Checkout state | Limit for new activations | Ends by |
| --- | --- | --- |
| `creating` / `open` (any `expires_at`) | `least(plan/override, target)` | activation (`completed`, atomic with the plan change), `failed` (provider rejected creation), `expired` (existing replacement in acquisition) |
| `completed` | the activated plan's own limit | - |
| `expired` / `failed` | plan/override limit | - |
| C2 plan change `requested`/`unknown`/`confirmed`/`manual_review` (`billing_subscription_plan_changes`) | `least(plan/override, target)` (`pending_plan_change`, `EMPLOYEE_PLAN_CHANGE_LIMIT_PENDING`); an upgrade target never widens | `completed` (target plan's own limit), `not_applied`, `abandoned` — see `docs/billing-plan-change-next-renewal.md` |

**Acquisition.** `acquire_billing_checkout_intent_v2` takes the capacity lock after the checkout
rows, the subscription and the plan, and refuses with `EMPLOYEE_OVER_TARGET_LIMIT` before any
provider call when active employees exceed the requested plan. An existing open checkout is not
offered again in that case. It refuses any new purchase with `BILLING_PURCHASE_ACTIVATION_PENDING`
while `resolve_billing_purchase_activation_v1()` reports a recognised unresolved activation: a
signed `subscription_created` for the salon that is still `received`, or parked as
`processor_checkout_capacity_exceeded`, `processor_checkout_state_invalid` or
`processor_retry_exhausted`. That guard also stops the replacement from expiring the waiting
purchase's open checkout. No release-stale action exists; an abandoned checkout ends only through
the existing replacement (a later purchase attempt after the URL expired and with no such event).

**Final activation check.** `process_billing_subscription_created_v2`, in the branch that
actually activates, takes the capacity lock after the subscription lock and re-counts active
employees against the requested plan. Above the limit it does not activate: the event is parked
as `processor_checkout_capacity_exceeded` with `salon_id`, the checkout stays `open` (the
reservation keeps holding) and the UI shows "Kupovina čeka aktivaciju. Nemojte pokretati novu
kupovinu." with the target limit. Already processed / idempotent redeliveries return before this
check and are never failed by a later employee change. "Plaćanje je primljeno" is shown only when
a paid `initial` invoice for the same provider subscription is recorded.

**Read-only deactivation.** `set_employee_active_state(..., false)` no longer requires full billing
access; tenant/role checks remain. Activation, reactivation, detail edits and deletion still require
full access and the capacity trigger. The employees page shows "Deaktiviraj" whenever entitlements
are loaded.

**Lock protocol.** Writers acquire, in this order and never the reverse: [operator recovery:
webhook event] -> event -> facts -> salon checkout rows (`created_at, id`) -> plan `FOR SHARE` ->
subscription `FOR UPDATE` -> capacity advisory lock. Acquisition starts with its own intent
advisory lock and locks checkout rows, subscription, plan, then capacity. The employee trigger
takes only the capacity lock (after its own row) and reads everything else without locks; in
READ COMMITTED each of its statements takes a fresh snapshot after the lock, so a committed
checkout or activation is visible. Updated processor and snapshot recovery lock subscription,
plan, mapping and never the capacity lock. Plan and mapping locks are `FOR SHARE` only.
Verified on disposable PostgreSQL by `npm run test:billing-c1-capacity-concurrency` (both orders
of acquisition/activation and created activation/activation, parallel operators, recovery versus
acquisition).

**Read-only preflight for checkouts opened before C1** (service role, no writes):

```sql
select c.id as checkout_id, c.salon_id, c.status, p.slug as target_plan, p.max_employees,
       (select count(*) from public.employees e where e.salon_id = c.salon_id and e.is_active) as active_employees
from public.billing_checkout_sessions c
join public.plans p on p.id = c.requested_plan_id
where c.status in ('creating', 'open') and p.max_employees is not null
  and (select count(*) from public.employees e where e.salon_id = c.salon_id and e.is_active) > p.max_employees;
```

Such checkouts are not reopened for payment; if they are paid, activation is parked as
`processor_checkout_capacity_exceeded` and recovered after the owner reduces active employees
(see `docs/billing-operator-recovery-runbook.md`). No employee is ever deactivated automatically.

**Proven locally / not confirmed remotely.** `npm run test:billing-c1-capacity`,
`npm run test:billing-c1-capacity-concurrency` and `npm run test:employee-capacity-parity` run on
disposable PostgreSQL only. The migration has not been applied to any remote database and no real
provider purchase has exercised these paths.

Unconfirmed release steps: apply `202610170045` and `202610180046` to the target database before
deploying the application that calls `resolve_employee_capacity_v2` and
`resolve_billing_purchase_activation_v1`; run the read-only preflight above first; then verify the
flows against the real provider. None of these steps has been performed.

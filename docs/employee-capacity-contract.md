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

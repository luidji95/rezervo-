import assert from "node:assert/strict";
import test from "node:test";
import { getEffectiveEmployeeLimit, getPendingCheckoutNotice, getPurchaseActivationNotice } from "./billingCapacityPresentation.ts";
import { loadBillingCapacityState, mapEmployeeCapacityRow, mapPurchaseActivationRow } from "./billingCapacityState.ts";
import { getEntitlementActionState } from "./entitlementLoadState.ts";
import type { SalonEntitlements } from "../types/entitlements.ts";

const base = { planCapabilities: { maxEmployees: 10 } } as Pick<SalonEntitlements, "planCapabilities" | "employeeCapacity" | "purchaseActivation">;
const pendingRow = { capacity_reason: "pending_checkout", max_employees: 3, plan_max_employees: 10, pending_plan_slug: "starter" };

test("database rows map to the authority shape and reject unknown values", () => {
  assert.deepEqual(mapEmployeeCapacityRow([pendingRow]), { maxEmployees: 3, planMaxEmployees: 10, reason: "pending_checkout", pendingPlanCode: "starter" });
  assert.deepEqual(mapEmployeeCapacityRow({ capacity_reason: "override", max_employees: null, plan_max_employees: null }), { maxEmployees: null, planMaxEmployees: null, reason: "override", pendingPlanCode: null });
  assert.equal(mapEmployeeCapacityRow([]), null);
  assert.equal(mapEmployeeCapacityRow([{ capacity_reason: "mystery", max_employees: 3 }]), null);
  // A pending downgrade narrows the limit; the browser must never fall back to the wider plan limit.
  const planChangeRow = { capacity_reason: "pending_plan_change", max_employees: 3, plan_max_employees: 10, pending_plan_slug: "starter" };
  assert.deepEqual(mapEmployeeCapacityRow([planChangeRow]), { maxEmployees: 3, planMaxEmployees: 10, reason: "pending_plan_change", pendingPlanCode: "starter" });
  assert.equal(getEffectiveEmployeeLimit({ ...base, employeeCapacity: mapEmployeeCapacityRow([planChangeRow]) }), 3);
  assert.equal(getPendingCheckoutNotice({ ...base, employeeCapacity: mapEmployeeCapacityRow([planChangeRow]) }), null);
  assert.equal(mapPurchaseActivationRow([]), null);
  assert.deepEqual(mapPurchaseActivationRow([{ webhook_event_id: "e1", pending_reason: "capacity", target_plan_slug: "starter", target_max_employees: 3, payment_confirmed: false }]),
    { reason: "capacity", targetPlanCode: "starter", targetMaxEmployees: 3, paymentConfirmed: false });
  assert.equal(mapPurchaseActivationRow([{ webhook_event_id: "e1", pending_reason: "unknown" }]), null);
});

test("loader asks the two database RPCs and degrades to null on errors", async () => {
  const calls: string[] = [];
  const ok = await loadBillingCapacityState({ rpc: async (name) => { calls.push(name); return { data: name.includes("capacity") ? [pendingRow] : [], error: null }; } }, "s1");
  assert.deepEqual(calls.sort(), ["resolve_billing_purchase_activation_v1", "resolve_employee_capacity_v2"]);
  assert.equal(ok.employeeCapacity?.maxEmployees, 3);
  assert.equal(ok.purchaseActivation, null);
  const failed = await loadBillingCapacityState({ rpc: async () => ({ data: null, error: { message: "missing" } }) }, "s1");
  assert.deepEqual(failed, { employeeCapacity: null, purchaseActivation: null });
});

test("UI limit is the database effective limit, falling back to the plan only when absent", () => {
  assert.equal(getEffectiveEmployeeLimit({ ...base, employeeCapacity: mapEmployeeCapacityRow([pendingRow]) }), 3);
  assert.equal(getEffectiveEmployeeLimit({ ...base, employeeCapacity: { maxEmployees: null, planMaxEmployees: null, reason: "override", pendingPlanCode: null } }), null);
  assert.equal(getEffectiveEmployeeLimit(base), 10);
  assert.match(getPendingCheckoutNotice({ ...base, employeeCapacity: mapEmployeeCapacityRow([pendingRow]) }) ?? "", /Starter .* na 3/);
  assert.equal(getPendingCheckoutNotice(base), null);
});

test("creation is gated by the effective limit; deactivation only needs loaded entitlements", () => {
  const entitlements = { ...base, isReadOnly: true, effectiveCapabilities: { canCreateEmployees: false, canManageBusinessData: false }, employeeCapacity: mapEmployeeCapacityRow([pendingRow]) } as unknown as SalonEntitlements;
  const readOnly = getEntitlementActionState({ loading: false, error: null, entitlements }, 2);
  assert.equal(readOnly.canCreateEmployee, false);
  assert.equal(readOnly.canManage, false);
  assert.equal(readOnly.canDeactivate, true);
  const full = { ...entitlements, isReadOnly: false, effectiveCapabilities: { canCreateEmployees: true, canManageBusinessData: true } } as unknown as SalonEntitlements;
  assert.equal(getEntitlementActionState({ loading: false, error: null, entitlements: full }, 2).canCreateEmployee, true);
  assert.equal(getEntitlementActionState({ loading: false, error: null, entitlements: full }, 3).canCreateEmployee, false);
  assert.equal(getEntitlementActionState({ loading: true, error: null, entitlements: null }, 0).canDeactivate, false);
});

test("pending activation text never claims payment without a recorded paid initial invoice", () => {
  const capacity = getPurchaseActivationNotice({ ...base, purchaseActivation: { reason: "capacity", targetPlanCode: "starter", targetMaxEmployees: 3, paymentConfirmed: false } }) ?? "";
  assert.match(capacity, /^Kupovina čeka aktivaciju\. Nemojte pokretati novu kupovinu\./);
  assert.match(capacity, /najviše 3.*podršci/);
  assert.doesNotMatch(capacity, /Plaćanje je primljeno/);
  const paid = getPurchaseActivationNotice({ ...base, purchaseActivation: { reason: "review", targetPlanCode: "starter", targetMaxEmployees: 3, paymentConfirmed: true } }) ?? "";
  assert.match(paid, /^Plaćanje je primljeno\. Kupovina čeka aktivaciju/);
  assert.equal(getPurchaseActivationNotice(base), null);
});

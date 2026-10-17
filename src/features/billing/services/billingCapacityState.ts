import type { EmployeeCapacity, PlanCode, PurchaseActivation } from "../types/entitlements.ts";

const PLAN_CODES = new Set(["starter", "pro", "premium"]);
const planCode = (value: unknown): PlanCode | null =>
  typeof value === "string" && PLAN_CODES.has(value) ? (value as PlanCode) : null;
const limit = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const firstRow = (data: unknown): Record<string, unknown> | null => {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
};

/** Maps one resolve_employee_capacity_v2 row; null when the database returned no usable row. */
export function mapEmployeeCapacityRow(data: unknown): EmployeeCapacity | null {
  const row = firstRow(data);
  if (!row) return null;
  const reason = row.capacity_reason;
  if (reason !== "plan" && reason !== "override" && reason !== "pending_checkout") return null;
  return {
    maxEmployees: limit(row.max_employees),
    planMaxEmployees: limit(row.plan_max_employees),
    reason,
    pendingPlanCode: reason === "pending_checkout" ? planCode(row.pending_plan_slug) : null,
  };
}

/** Maps one resolve_billing_purchase_activation_v1 row; null when nothing is pending. */
export function mapPurchaseActivationRow(data: unknown): PurchaseActivation | null {
  const row = firstRow(data);
  if (!row || typeof row.webhook_event_id !== "string") return null;
  const reason = row.pending_reason;
  if (reason !== "processing" && reason !== "capacity" && reason !== "review") return null;
  return {
    reason,
    targetPlanCode: planCode(row.target_plan_slug),
    targetMaxEmployees: limit(row.target_max_employees),
    paymentConfirmed: row.payment_confirmed === true,
  };
}

type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

/**
 * Reads the database-owned capacity and pending-activation state. Failures yield null, so the
 * UI falls back to the plan limit for display only; the employee trigger still enforces the
 * effective limit in the database.
 */
export async function loadBillingCapacityState(client: RpcClient, salonId: string) {
  const [capacity, activation] = await Promise.all([
    client.rpc("resolve_employee_capacity_v2", { p_salon_id: salonId }),
    client.rpc("resolve_billing_purchase_activation_v1", { p_salon_id: salonId }),
  ]);
  return {
    employeeCapacity: capacity.error ? null : mapEmployeeCapacityRow(capacity.data),
    purchaseActivation: activation.error ? null : mapPurchaseActivationRow(activation.data),
  };
}

import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type { BillingPlanChangeConfig } from "./billingPlanChangeConfigCore.ts";
import { BLOCKING_PLAN_CHANGE_STATUSES, type BillingPlanChangeRepository, type PlanChangeTarget } from "./billingPlanChangeCore.ts";
import { toPlanChangeView } from "./billingPlanChangeEndpointCore.ts";
import type { PlanChangeOverview, PlanChangeUnavailableReason } from "../types/planChange.ts";

export type { PlanChangeOverview, PlanChangeUnavailableReason } from "../types/planChange.ts";

const PREPARE_REASONS: Record<string, PlanChangeUnavailableReason> = {
  BILLING_PLAN_CHANGE_FORBIDDEN: "not_owner",
  BILLING_PLAN_CHANGE_PENDING: "pending",
  BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE: "renewal_too_close",
  EMPLOYEE_OVER_TARGET_LIMIT: "employees_over_target",
  BILLING_SUBSCRIPTION_PAYMENT_REQUIRED: "payment_required",
  BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED: "cancelled",
  BILLING_PLAN_CHANGE_OVERRIDE_ACTIVE: "override_active",
  BILLING_PURCHASE_ACTIVATION_PENDING: "purchase_pending",
  BILLING_PLAN_CHANGE_ENVIRONMENT_MISMATCH: "unavailable",
  BILLING_PLAN_CHANGE_MAPPING_INVALID: "unavailable",
};

/** Terminal changes stay visible for a short while after their effective date so the outcome is explained. */
const TERMINAL_VISIBLE_MS = 35 * 86_400_000;

export const UNAVAILABLE_PLAN_CHANGE: PlanChangeOverview = {
  canRequest: false, unavailableReason: "unavailable", targetPlan: null, effectiveAt: null, canCheckStatus: false, current: null,
};

/**
 * Read-only availability for the billing overview. Database reads only (latest change and the
 * read-only prepare RPC); never a provider call and never a mutation.
 */
export async function resolvePlanChangeOverview(
  input: { userId: string; salonId: string; isOwner: boolean; currentPlanCode: string | null; now: Date },
  dependencies: {
    getConfig(): BillingPlanChangeConfig | null;
    environmentMatches(environment: BillingEnvironment): Promise<boolean>;
    repository: BillingPlanChangeRepository;
  },
): Promise<PlanChangeOverview> {
  const { repository } = dependencies;
  let latest = null;
  try { latest = await repository.latestChange(input.salonId); } catch { return UNAVAILABLE_PLAN_CHANGE; }
  const blocking = latest !== null && BLOCKING_PLAN_CHANGE_STATUSES.has(latest.status);
  const recent = latest !== null && (blocking || Date.parse(latest.baselinePeriodEnd) > input.now.getTime() - TERMINAL_VISIBLE_MS);
  const current = latest && recent ? toPlanChangeView(latest) : null;
  const result = (overrides: Partial<PlanChangeOverview>): PlanChangeOverview => ({
    canRequest: false, unavailableReason: null, targetPlan: null, effectiveAt: null, canCheckStatus: false, current, ...overrides,
  });

  if (!input.isOwner) return result({ unavailableReason: "not_owner" });
  const config = dependencies.getConfig();
  let enabled = false;
  if (config) {
    try { enabled = await dependencies.environmentMatches(config.environment) === true; } catch { enabled = false; }
  }
  if (!enabled) return result({ unavailableReason: "disabled" });
  if (blocking) return result({ unavailableReason: "pending", canCheckStatus: true });

  const targetPlan: PlanChangeTarget | null = input.currentPlanCode === "starter" ? "pro" : input.currentPlanCode === "pro" ? "starter" : null;
  if (!targetPlan) return result({ unavailableReason: "not_applicable" });
  try {
    const targetPlanId = await repository.findActivePlanId(targetPlan);
    if (!targetPlanId) return result({ unavailableReason: "not_applicable" });
    const prepared = await repository.prepare({ salonId: input.salonId, actorProfileId: input.userId, targetPlanId, now: input.now.toISOString() });
    if (prepared.outcome === "eligible" && prepared.baselinePeriodEnd && Number.isFinite(Date.parse(prepared.baselinePeriodEnd))) {
      return result({ canRequest: true, targetPlan, effectiveAt: prepared.baselinePeriodEnd });
    }
    const reason = prepared.errorCode ? PREPARE_REASONS[prepared.errorCode] ?? "not_applicable" : "not_applicable";
    // The capacity reason keeps the target so the UI can show the target employee limit.
    return result({ unavailableReason: reason, targetPlan: reason === "employees_over_target" ? targetPlan : null, canCheckStatus: reason === "pending" });
  } catch {
    return result({ unavailableReason: "unavailable" });
  }
}

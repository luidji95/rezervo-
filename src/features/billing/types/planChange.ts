/** Client-safe C2 plan-change shapes (sanitized; no provider identifiers, tokens or URLs). */

export type PlanChangeTargetCode = "starter" | "pro";

/** "completed" only when the database completed the change. */
export type PlanChangeState = "pending_confirmation" | "scheduled" | "review_required" | "completed" | "not_applied" | "abandoned";

export type PlanChangeView = {
  id: string;
  state: PlanChangeState;
  direction: "upgrade" | "downgrade";
  targetPlan: PlanChangeTargetCode | null;
  /** Immutable effective date (the paid period end at request time). */
  effectiveAt: string;
  nextAction: "none" | "check_status_later" | "contact_support";
};

/** Stable, user-safe reasons; they explain the UI only (the endpoint and the database re-check everything). */
export type PlanChangeUnavailableReason =
  | "disabled" | "not_owner" | "not_applicable" | "pending" | "renewal_too_close" | "employees_over_target"
  | "payment_required" | "cancelled" | "override_active" | "purchase_pending" | "unavailable";

export type PlanChangeOverview = {
  canRequest: boolean;
  unavailableReason: PlanChangeUnavailableReason | null;
  /** The single possible target (Starter <-> Pro), when applicable. */
  targetPlan: PlanChangeTargetCode | null;
  /** Effective date a request made now would get (the current paid period end), only when requestable. */
  effectiveAt: string | null;
  /** Explicit provider status check is possible (owner, enabled, unresolved change). */
  canCheckStatus: boolean;
  /** Latest relevant change of the salon, shown even when the flag was switched off later. */
  current: PlanChangeView | null;
};

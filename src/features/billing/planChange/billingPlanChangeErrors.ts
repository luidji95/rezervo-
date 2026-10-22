export const BILLING_PLAN_CHANGE_ERROR_CODES = [
  "BILLING_PLAN_CHANGE_REQUEST_INVALID",
  "BILLING_PLAN_CHANGE_UNAUTHORIZED",
  "BILLING_PLAN_CHANGE_FORBIDDEN",
  "BILLING_PLAN_CHANGE_DISABLED",
  "BILLING_PLAN_CHANGE_NOT_ELIGIBLE",
  "BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE",
  "BILLING_PLAN_CHANGE_EMPLOYEES_OVER_TARGET",
  "BILLING_PLAN_CHANGE_PAYMENT_REQUIRED",
  "BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED",
  "BILLING_PLAN_CHANGE_PURCHASE_PENDING",
  "BILLING_PLAN_CHANGE_PAYMENT_METHOD_UNSUPPORTED",
  "BILLING_PLAN_CHANGE_STATE_CHANGED",
  "BILLING_PLAN_CHANGE_PROVIDER_UNAVAILABLE",
  "BILLING_PLAN_CHANGE_NOT_FOUND",
  "BILLING_PLAN_CHANGE_INTERNAL_ERROR",
] as const;

export type BillingPlanChangeErrorCode = (typeof BILLING_PLAN_CHANGE_ERROR_CODES)[number];

/** Errors raised before any provider mutation; none of them means a change was sent. */
export class BillingPlanChangeError extends Error {
  readonly code: BillingPlanChangeErrorCode;
  readonly status: number;

  constructor(code: BillingPlanChangeErrorCode, status: number) {
    super(code);
    this.name = "BillingPlanChangeError";
    this.code = code;
    this.status = status;
  }
}

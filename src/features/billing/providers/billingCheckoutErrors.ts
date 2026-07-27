export const BILLING_CHECKOUT_ERROR_CODES = [
  "BILLING_NOT_CONFIGURED",
  "BILLING_CHECKOUT_DISABLED",
  "BILLING_OWNER_REQUIRED",
  "BILLING_PLAN_NOT_AVAILABLE",
  "BILLING_OVERRIDE_ACTIVE",
  "BILLING_PRICE_MAPPING_MISSING",
  "BILLING_PRICE_MISMATCH",
  "BILLING_CHECKOUT_IN_PROGRESS",
  "BILLING_PROVIDER_UNAVAILABLE",
  "BILLING_PROVIDER_REJECTED",
  "BILLING_RECONCILIATION_REQUIRED",
  "INVALID_INPUT",
  "FORBIDDEN",
] as const;

export type BillingCheckoutErrorCode =
  (typeof BILLING_CHECKOUT_ERROR_CODES)[number];

export class BillingCheckoutError extends Error {
  readonly code: BillingCheckoutErrorCode;
  readonly status: number;

  constructor(code: BillingCheckoutErrorCode, status: number) {
    super(code);
    this.name = "BillingCheckoutError";
    this.code = code;
    this.status = status;
  }
}

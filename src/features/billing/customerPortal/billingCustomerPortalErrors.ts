export const BILLING_CUSTOMER_PORTAL_ERROR_CODES = [
  "BILLING_PORTAL_REQUEST_INVALID",
  "BILLING_PORTAL_UNAUTHORIZED",
  "BILLING_PORTAL_FORBIDDEN",
  "BILLING_PORTAL_SUBSCRIPTION_UNAVAILABLE",
  "BILLING_PORTAL_RATE_LIMITED",
  "BILLING_PORTAL_PROVIDER_UNAVAILABLE",
  "BILLING_PORTAL_DISABLED",
  "BILLING_PORTAL_INTERNAL_ERROR",
] as const;

export type BillingCustomerPortalErrorCode =
  (typeof BILLING_CUSTOMER_PORTAL_ERROR_CODES)[number];

export class BillingCustomerPortalError extends Error {
  readonly code: BillingCustomerPortalErrorCode;
  readonly status: number;

  constructor(code: BillingCustomerPortalErrorCode, status: number) {
    super(code);
    this.name = "BillingCustomerPortalError";
    this.code = code;
    this.status = status;
  }
}

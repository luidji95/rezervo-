export const BILLING_WEBHOOK_ERROR_CODES = [
  "BILLING_WEBHOOK_DISABLED",
  "BILLING_WEBHOOK_NOT_CONFIGURED",
  "BILLING_WEBHOOK_SIGNATURE_MISSING",
  "BILLING_WEBHOOK_SIGNATURE_INVALID",
  "BILLING_WEBHOOK_PAYLOAD_INVALID",
  "BILLING_WEBHOOK_ENVIRONMENT_MISMATCH",
  "BILLING_WEBHOOK_STORAGE_FAILED",
] as const;

export type BillingWebhookErrorCode =
  (typeof BILLING_WEBHOOK_ERROR_CODES)[number];

export class BillingWebhookError extends Error {
  readonly code: BillingWebhookErrorCode;
  readonly status: number;

  constructor(code: BillingWebhookErrorCode, status: number) {
    super(code);
    this.name = "BillingWebhookError";
    this.code = code;
    this.status = status;
  }
}

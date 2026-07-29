import { createHash, timingSafeEqual } from "node:crypto";

export type BillingWebhookRetryWorkerConfig = { enabled: true; secret: string; batchSize: number };
export type BillingWebhookRetryWorkerEnvironment = { BILLING_WORKER_ENABLED?: string; BILLING_WORKER_SECRET?: string; BILLING_WORKER_BATCH_SIZE?: string };

export class BillingWebhookRetryWorkerConfigError extends Error {
  readonly code: "BILLING_WORKER_DISABLED";
  constructor(code: "BILLING_WORKER_DISABLED") { super(code); this.name = "BillingWebhookRetryWorkerConfigError"; this.code = code; }
}

export function getBillingWebhookRetryWorkerConfig(
  environment: BillingWebhookRetryWorkerEnvironment = process.env as BillingWebhookRetryWorkerEnvironment,
): BillingWebhookRetryWorkerConfig {
  const secret = environment.BILLING_WORKER_SECRET?.trim();
  if (environment.BILLING_WORKER_ENABLED !== "true" || !secret) throw new BillingWebhookRetryWorkerConfigError("BILLING_WORKER_DISABLED");
  const parsed = Number(environment.BILLING_WORKER_BATCH_SIZE ?? "10");
  return { enabled: true, secret, batchSize: Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 10 };
}

export function verifyBillingWorkerAuthorization(authorization: string | null, expectedSecret: string) {
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!supplied || !expectedSecret) return false;
  const expectedHash = createHash("sha256").update(expectedSecret).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

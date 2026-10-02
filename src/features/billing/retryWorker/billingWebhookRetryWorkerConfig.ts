import { createHash, timingSafeEqual } from "node:crypto";
import {
  parseBillingEnvironment,
  type BillingEnvironment,
} from "../config/billingEnvironment.ts";

export type BillingWebhookRetryWorkerConfig = { enabled: true; environment: BillingEnvironment; secret: string; batchSize: number };
export type BillingWebhookRetryWorkerEnvironment = Record<string, string | undefined>;

export class BillingWebhookRetryWorkerConfigError extends Error {
  readonly code: "BILLING_WORKER_DISABLED";
  constructor(code: "BILLING_WORKER_DISABLED") { super(code); this.name = "BillingWebhookRetryWorkerConfigError"; this.code = code; }
}

export function getBillingWebhookRetryWorkerConfig(
  trustedEnvironment: BillingEnvironment,
  environment: BillingWebhookRetryWorkerEnvironment = process.env as BillingWebhookRetryWorkerEnvironment,
): BillingWebhookRetryWorkerConfig {
  let deployedEnvironment: BillingEnvironment;
  try { deployedEnvironment = parseBillingEnvironment(environment.BILLING_ENVIRONMENT); }
  catch { throw new BillingWebhookRetryWorkerConfigError("BILLING_WORKER_DISABLED"); }
  if (environment.BILLING_PROVIDER !== "lemonsqueezy" || deployedEnvironment !== trustedEnvironment) {
    throw new BillingWebhookRetryWorkerConfigError("BILLING_WORKER_DISABLED");
  }
  const enabled = trustedEnvironment === "test"
    ? environment.BILLING_WORKER_ENABLED
    : environment.BILLING_LIVE_WORKER_ENABLED;
  const secret = (trustedEnvironment === "test"
    ? environment.BILLING_WORKER_SECRET
    : environment.BILLING_LIVE_WORKER_SECRET)?.trim();
  if (enabled !== "true" || !secret) throw new BillingWebhookRetryWorkerConfigError("BILLING_WORKER_DISABLED");
  const defaultBatchSize = trustedEnvironment === "test" ? 10 : 5;
  const rawBatchSize = trustedEnvironment === "test"
    ? environment.BILLING_WORKER_BATCH_SIZE
    : environment.BILLING_LIVE_WORKER_BATCH_SIZE;
  const parsed = Number(rawBatchSize ?? String(defaultBatchSize));
  return {
    enabled: true,
    environment: trustedEnvironment,
    secret,
    batchSize: Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : defaultBatchSize,
  };
}

export function verifyBillingWorkerAuthorization(authorization: string | null, expectedSecret: string) {
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!supplied || !expectedSecret) return false;
  const expectedHash = createHash("sha256").update(expectedSecret).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

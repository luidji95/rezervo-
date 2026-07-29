import type { BillingWebhookRetrySummary } from "./billingWebhookRetryWorkerCore.ts";
import { BillingWebhookRetryWorkerConfigError, type BillingWebhookRetryWorkerConfig, verifyBillingWorkerAuthorization } from "./billingWebhookRetryWorkerConfig.ts";

export type BillingWebhookRetryEndpointResult = {
  status: number;
  body: { success: true; summary: BillingWebhookRetrySummary } | { success: false; code: string };
  headers: { "Cache-Control": "no-store" };
};

function failure(code: string, status: number): BillingWebhookRetryEndpointResult {
  return { status, body: { success: false, code }, headers: { "Cache-Control": "no-store" } };
}

export async function handleBillingWebhookRetryRequest(input: {
  request: Request;
  getConfig: () => BillingWebhookRetryWorkerConfig;
  runWorker: (batchSize: number) => Promise<BillingWebhookRetrySummary>;
}): Promise<BillingWebhookRetryEndpointResult> {
  let config: BillingWebhookRetryWorkerConfig;
  try { config = input.getConfig(); }
  catch (error) {
    if (error instanceof BillingWebhookRetryWorkerConfigError) return failure("BILLING_WORKER_DISABLED", 503);
    return failure("BILLING_WORKER_INTERNAL_ERROR", 500);
  }
  if (!verifyBillingWorkerAuthorization(input.request.headers.get("authorization"), config.secret)) return failure("BILLING_WORKER_UNAUTHORIZED", 401);
  const url = new URL(input.request.url);
  if (url.search || (await input.request.text()).length > 0) return failure("BILLING_WORKER_REQUEST_INVALID", 400);
  try {
    const summary = await input.runWorker(config.batchSize);
    return { status: 200, body: { success: true, summary }, headers: { "Cache-Control": "no-store" } };
  } catch {
    return failure("BILLING_WORKER_INTERNAL_ERROR", 500);
  }
}

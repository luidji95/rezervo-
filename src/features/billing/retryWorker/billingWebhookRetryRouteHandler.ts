import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { BillingEnvironment } from "../config/billingEnvironment";
import { handleBillingWebhookRetryRequest } from "./billingWebhookRetryEndpointCore";
import { getBillingWebhookRetryWorkerConfig } from "./billingWebhookRetryWorkerConfig";

export async function handleBillingWebhookRetryRoute(
  request: Request,
  trustedEnvironment: BillingEnvironment,
) {
  const startedAt = Date.now();
  const runId = randomUUID();
  const result = await handleBillingWebhookRetryRequest({
    request,
    getConfig: () => getBillingWebhookRetryWorkerConfig(trustedEnvironment),
    runWorker: async (batchSize) => {
      const { runBillingWebhookRetryWorker } = await import("./billingWebhookRetryWorkerCore");
      const { SupabaseBillingWebhookRetryRepository } = await import("./supabaseBillingWebhookRetryRepository");
      return runBillingWebhookRetryWorker({
        repository: new SupabaseBillingWebhookRetryRepository(trustedEnvironment),
        environment: trustedEnvironment,
        batchSize,
      });
    },
  });
  if (result.body.success) {
    console.info("Billing webhook retry worker completed", {
      runId,
      ...result.body.summary,
      durationMs: Date.now() - startedAt,
    });
  }
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}

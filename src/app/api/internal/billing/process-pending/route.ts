import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { handleBillingWebhookRetryRequest } from "@/features/billing/retryWorker/billingWebhookRetryEndpointCore";
import { getBillingWebhookRetryWorkerConfig } from "@/features/billing/retryWorker/billingWebhookRetryWorkerConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const runId = randomUUID();
  const result = await handleBillingWebhookRetryRequest({
    request,
    getConfig: getBillingWebhookRetryWorkerConfig,
    runWorker: async (batchSize) => {
      const { runBillingWebhookRetryWorker } = await import("@/features/billing/retryWorker/billingWebhookRetryWorkerCore");
      const { SupabaseBillingWebhookRetryRepository } = await import("@/features/billing/retryWorker/supabaseBillingWebhookRetryRepository");
      return runBillingWebhookRetryWorker({ repository: new SupabaseBillingWebhookRetryRepository(), batchSize });
    },
  });
  if (result.body.success) {
    console.info("Billing webhook retry worker completed", { runId, ...result.body.summary, durationMs: Date.now() - startedAt });
  }
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

import { handleBillingWebhookRetryRoute } from "@/features/billing/retryWorker/billingWebhookRetryRouteHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleBillingWebhookRetryRoute(request, "live");
}

import { handleLemonSqueezyWebhookRequest } from "@/features/billing/webhooks/lemonSqueezyWebhookRouteHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Compatibility alias until the Lemon Squeezy sandbox target moves to /test.
  return handleLemonSqueezyWebhookRequest(request, "test");
}

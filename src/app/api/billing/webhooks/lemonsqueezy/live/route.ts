import { handleLemonSqueezyWebhookRequest } from "@/features/billing/webhooks/lemonSqueezyWebhookRouteHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleLemonSqueezyWebhookRequest(request, "live");
}

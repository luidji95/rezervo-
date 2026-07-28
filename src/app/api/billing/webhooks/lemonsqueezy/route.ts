import { NextResponse } from "next/server";

import { getBillingWebhookConfig } from "@/features/billing/webhooks/billingWebhookConfig";
import { BillingWebhookError } from "@/features/billing/webhooks/billingWebhookErrors";
import { ingestLemonSqueezyWebhook } from "@/features/billing/webhooks/lemonSqueezyWebhookCore";
import { SupabaseBillingWebhookEventRepository } from "@/features/billing/webhooks/supabaseBillingWebhookEventRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof BillingWebhookError) {
    return NextResponse.json(
      { success: false, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { success: false, code: "BILLING_WEBHOOK_STORAGE_FAILED" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const config = getBillingWebhookConfig();
    const signature = request.headers.get("x-signature");
    const rawBody = await request.text();
    const result = await ingestLemonSqueezyWebhook({
      rawBody,
      signature,
      webhookSecret: config.webhookSecret,
      repository: new SupabaseBillingWebhookEventRepository(),
    });
    return NextResponse.json(
      { success: true, status: result.status },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

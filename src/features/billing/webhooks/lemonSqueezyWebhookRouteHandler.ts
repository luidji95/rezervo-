import "server-only";

import { NextResponse } from "next/server";

import type { BillingEnvironment } from "../config/billingEnvironment";
import { getBillingWebhookConfig } from "./billingWebhookConfig";
import { BillingWebhookError } from "./billingWebhookErrors";
import { ingestLemonSqueezyWebhook } from "./lemonSqueezyWebhookCore";
import { SupabaseBillingWebhookEventRepository } from "./supabaseBillingWebhookEventRepository";

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

export async function handleLemonSqueezyWebhookRequest(
  request: Request,
  environment: BillingEnvironment,
) {
  try {
    const config = getBillingWebhookConfig(environment);
    const signature = request.headers.get("x-signature");
    const rawBody = await request.text();
    const result = await ingestLemonSqueezyWebhook({
      rawBody,
      signature,
      webhookSecret: config.webhookSecret,
      environment: config.environment,
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

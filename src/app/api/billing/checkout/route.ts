import { NextResponse } from "next/server";

import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { BillingCheckoutError } from "@/features/billing/providers/billingCheckoutErrors";
import { LemonSqueezyBillingProvider } from "@/features/billing/providers/lemonSqueezyBillingProvider";
import { createBillingCheckout } from "@/features/billing/services/billingCheckoutCore";
import { getBillingCheckoutConfig } from "@/features/billing/services/billingCheckoutConfig";
import { parseBillingCheckoutRequest } from "@/features/billing/services/billingCheckoutRequest";
import { SupabaseBillingCheckoutRepository } from "@/features/billing/services/supabaseBillingCheckoutRepository";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof BillingCheckoutError) {
    return NextResponse.json(
      { success: false, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { success: false, code: "BILLING_PROVIDER_UNAVAILABLE" },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  try {
    const config = getBillingCheckoutConfig();
    const auth = await getAuthenticatedRequestUser(request);
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, code: "FORBIDDEN" },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new BillingCheckoutError("INVALID_INPUT", 400);
    }
    const parsed = parseBillingCheckoutRequest(body);

    const provider = new LemonSqueezyBillingProvider(config.apiKey);
    const repository = new SupabaseBillingCheckoutRepository();
    const result = await createBillingCheckout(
      {
        ...parsed,
        actorProfileId: auth.user.id,
        actorEmail: auth.user.email,
      },
      repository,
      provider,
      { appUrl: config.appUrl, storeId: config.storeId, now: () => new Date() },
    );

    return NextResponse.json(
      { success: true, checkout: result },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

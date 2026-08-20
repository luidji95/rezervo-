import { NextResponse } from "next/server";

import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { BillingCheckoutError } from "@/features/billing/providers/billingCheckoutErrors";
import { LemonSqueezyBillingProvider } from "@/features/billing/providers/lemonSqueezyBillingProvider";
import { LemonSqueezyCheckoutRetrievalClient } from "@/features/billing/providers/lemonSqueezyCheckoutRetrievalCore";
import { createBillingCheckout } from "@/features/billing/services/billingCheckoutCore";
import { getBillingCheckoutConfig } from "@/features/billing/services/billingCheckoutConfig";
import { parseBillingCheckoutRequest } from "@/features/billing/services/billingCheckoutRequest";
import { SupabaseBillingCheckoutRepository } from "@/features/billing/services/supabaseBillingCheckoutRepository";
import { runBillingCheckoutDirectRecovery } from "@/features/billing/checkoutRecovery/billingCheckoutRecoveryCore";
import { createSupabaseBillingCheckoutRecoveryRepository } from "@/features/billing/checkoutRecovery/supabaseBillingCheckoutRecoveryRepository.server";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof BillingCheckoutError) {
    const message = error.code === "BILLING_CHECKOUT_PENDING"
      ? "Checkout preparation is already in progress. Please try again shortly."
      : undefined;
    return NextResponse.json(
      { success: false, code: error.code, ...(message ? { message } : {}) },
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
    const retrievalProvider = new LemonSqueezyCheckoutRetrievalClient(config, fetch);
    const repository = new SupabaseBillingCheckoutRepository(
      config.environment,
    );
    const recoveryRepository =
      createSupabaseBillingCheckoutRecoveryRepository();
    const result = await createBillingCheckout(
      {
        ...parsed,
        actorProfileId: auth.user.id,
        actorEmail: auth.user.email,
      },
      repository,
      provider,
      {
        appUrl: config.appUrl,
        storeId: config.storeId,
        environment: config.environment,
        liveAllowedSalonIds: config.liveAllowedSalonIds,
        now: () => new Date(),
      },
      retrievalProvider,
      (checkoutSessionId) =>
        runBillingCheckoutDirectRecovery({
          checkoutSessionId,
          environment: config.environment,
          leaseSeconds: 300,
          providerStoreId: config.storeId,
          now: () => new Date(),
          repository: recoveryRepository,
          provider: {
            retrieveById: (providerCheckoutId) =>
              retrievalProvider.retrieveById(providerCheckoutId),
          },
        }),
    );

    const { responseStatus, ...checkout } = result;
    return NextResponse.json(
      { success: true, checkout },
      { status: responseStatus, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

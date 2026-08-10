import "server-only";

import { NextResponse } from "next/server";

import type { BillingEnvironment } from "../config/billingEnvironment";
import { LemonSqueezyCheckoutRetrievalClient } from "../providers/lemonSqueezyCheckoutRetrievalCore";
import { resolveBillingCheckoutRecoveryConfig } from "./billingCheckoutRecoveryConfig";
import {
  createLemonSqueezyRecoveryGateway,
  runBillingCheckoutRecovery,
} from "./billingCheckoutRecoveryCore";
import { handleBillingCheckoutRecoveryRequest } from "./billingCheckoutRecoveryEndpointCore";
import { createSupabaseBillingCheckoutRecoveryRepository } from "./supabaseBillingCheckoutRecoveryRepository.server";

export async function handleBillingCheckoutRecoveryRoute(
  request: Request,
  trustedEnvironment: BillingEnvironment,
) {
  const result = await handleBillingCheckoutRecoveryRequest({
    request,
    getConfig: () => resolveBillingCheckoutRecoveryConfig(process.env, trustedEnvironment),
    runRecovery: async (checkoutSessionId, config) => {
      const repository = createSupabaseBillingCheckoutRecoveryRepository();
      const client = new LemonSqueezyCheckoutRetrievalClient(config.provider, fetch);
      return runBillingCheckoutRecovery({
        checkoutSessionId,
        environment: trustedEnvironment,
        leaseSeconds: config.leaseSeconds,
        pageSize: config.pageSize,
        maxPages: config.maxPages,
        providerStoreId: config.provider.storeId,
        now: () => new Date(),
        repository,
        provider: createLemonSqueezyRecoveryGateway({ client, providerConfig: config.provider }),
      });
    },
  });
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

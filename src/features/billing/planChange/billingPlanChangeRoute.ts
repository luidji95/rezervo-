import "server-only";

import { NextResponse } from "next/server";

import { billingPortalEnvironmentMatches } from "@/features/billing/customerPortal/billingCustomerPortalAvailability";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { supabaseServer } from "@/lib/supabaseServer";

import { getBillingPlanChangeConfig } from "./billingPlanChangeConfig";
import { handleBillingPlanChangePost } from "./billingPlanChangeEndpointCore";
import { LemonSqueezyPlanChangeProvider } from "./lemonSqueezyPlanChangeProvider";
import { SupabaseBillingPlanChangeRepository } from "./supabaseBillingPlanChangeRepository";
import type { PlanChangeDatabaseClient } from "./supabaseBillingPlanChangeRepositoryCore";

// Narrowed to the surface the repository uses (full SupabaseClient generics are too deep to compare).
const serviceClient = supabaseServer as unknown as PlanChangeDatabaseClient;

/** Shared server wiring for the request and status routes (default-off, owner-only). */
export async function billingPlanChangeRoute(mode: "request" | "refresh", request: Request) {
  const result = await handleBillingPlanChangePost(mode, request, {
    authenticate: async (authenticatedRequest) => {
      const auth = await getAuthenticatedRequestUser(authenticatedRequest);
      return auth.ok ? auth.user.id : null;
    },
    getConfig: getBillingPlanChangeConfig,
    environmentMatches: (environment) => billingPortalEnvironmentMatches(supabaseServer, environment),
    repository: new SupabaseBillingPlanChangeRepository(serviceClient),
    getProvider: (config) => new LemonSqueezyPlanChangeProvider(config),
    now: () => new Date(),
  });
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

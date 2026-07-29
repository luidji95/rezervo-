import { NextResponse } from "next/server";

import { getBillingCustomerPortalConfig } from "@/features/billing/customerPortal/billingCustomerPortalConfig";
import { handleBillingCustomerPortalPost } from "@/features/billing/customerPortal/billingCustomerPortalEndpointCore";
import { LemonSqueezyCustomerPortalProvider } from "@/features/billing/customerPortal/lemonSqueezyCustomerPortal";
import { SupabaseBillingCustomerPortalRepository } from "@/features/billing/customerPortal/supabaseBillingCustomerPortalRepository";
import { createAuthenticatedRequestClient, getAuthenticatedRequestUser } from "@/lib/server/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleBillingCustomerPortalPost(request, {
    authenticate: async (authenticatedRequest) => {
      const auth = await getAuthenticatedRequestUser(authenticatedRequest);
      if (!auth.ok) return null;
      const client = createAuthenticatedRequestClient(authenticatedRequest);
      return client ? { userId: auth.user.id, repository: new SupabaseBillingCustomerPortalRepository(client) } : null;
    },
    getProvider: () => new LemonSqueezyCustomerPortalProvider(getBillingCustomerPortalConfig()),
  });
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

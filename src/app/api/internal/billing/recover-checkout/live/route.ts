import { handleBillingCheckoutRecoveryRoute } from "@/features/billing/checkoutRecovery/billingCheckoutRecoveryRouteHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleBillingCheckoutRecoveryRoute(request, "live");
}

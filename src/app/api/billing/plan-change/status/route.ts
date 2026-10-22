import { billingPlanChangeRoute } from "@/features/billing/planChange/billingPlanChangeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status check: provider read, observed evidence and evaluation. Never sends a provider mutation. */
export async function POST(request: Request) {
  return billingPlanChangeRoute("refresh", request);
}

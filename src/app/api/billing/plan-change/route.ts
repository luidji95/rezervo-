import { billingPlanChangeRoute } from "@/features/billing/planChange/billingPlanChangeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return billingPlanChangeRoute("request", request);
}

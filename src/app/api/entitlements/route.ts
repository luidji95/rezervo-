import { NextResponse } from "next/server";

import { EntitlementError, resolveSalonEntitlements } from "@/features/billing/services/entitlementService";
import { buildEntitlementApiSuccess, getEntitlementApiErrorStatus } from "@/features/billing/services/entitlementApiContract";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { loadBillingCapacityState } from "@/features/billing/services/billingCapacityState";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  const salonId = new URL(request.url).searchParams.get("salonId");
  if (!salonId) {
    return NextResponse.json({ success: false, code: "SALON_REQUIRED" }, { status: 400 });
  }
  try {
    const entitlements = await resolveSalonEntitlements({ authenticatedUserId: auth.user.id, salonId });
    // Authorization happened above; capacity and pending activation come from the database authority.
    const capacityState = await loadBillingCapacityState(supabaseServer, salonId);
    return NextResponse.json(buildEntitlementApiSuccess({ ...entitlements, ...capacityState }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof EntitlementError ? error.code : "ENTITLEMENTS_LOAD_FAILED";
    const status = getEntitlementApiErrorStatus(code);
    return NextResponse.json({ success: false, code }, { status });
  }
}

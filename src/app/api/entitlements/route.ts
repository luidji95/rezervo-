import { NextResponse } from "next/server";

import { EntitlementError, resolveSalonEntitlements } from "@/features/billing/services/entitlementService";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";

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
    return NextResponse.json({ success: true, entitlements }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof EntitlementError ? error.code : "ENTITLEMENTS_LOAD_FAILED";
    const status = code === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ success: false, code }, { status });
  }
}


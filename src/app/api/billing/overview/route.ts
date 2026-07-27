import { NextResponse } from "next/server";

import { EntitlementError, resolveSalonEntitlements } from "@/features/billing/services/entitlementService";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizePlanCatalog, type PlanCatalogRow } from "@/features/billing/services/planCatalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return NextResponse.json({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  const salonId = new URL(request.url).searchParams.get("salonId");
  if (!salonId) return NextResponse.json({ success: false, code: "SALON_REQUIRED" }, { status: 400 });

  try {
    const [{ data: salon, error: salonError }, { data: membership, error: membershipError }] = await Promise.all([
      supabaseServer.from("salons").select("owner_id").eq("id", salonId).maybeSingle(),
      supabaseServer.from("salon_members").select("role").eq("salon_id", salonId).eq("profile_id", auth.user.id).eq("status", "active").in("role", ["owner", "manager"]).maybeSingle(),
    ]);
    if (salonError || membershipError) throw new Error("BILLING_AUTHORIZATION_FAILED");
    if (!salon || (salon.owner_id !== auth.user.id && !membership)) throw new EntitlementError("FORBIDDEN");
    await resolveSalonEntitlements({ authenticatedUserId: auth.user.id, salonId });
    const [{ count, error }, { data: plans, error: plansError }] = await Promise.all([
      supabaseServer.from("employees").select("id", { count: "exact", head: true }).eq("salon_id", salonId).eq("is_active", true),
      supabaseServer.from("plans").select("slug, name, monthly_price, yearly_price, currency, max_employees, is_active").in("slug", ["starter", "pro", "premium"]).order("sort_order"),
    ]);
    if (error || plansError) throw error ?? plansError;
    const catalog = normalizePlanCatalog((plans ?? []) as unknown as PlanCatalogRow[]);
    if (catalog.length !== 3) throw new Error("PLAN_CATALOG_INCOMPLETE");
    return NextResponse.json({ success: true, usage: { activeEmployees: count ?? 0 }, plans: catalog }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof EntitlementError && error.code === "FORBIDDEN" ? "FORBIDDEN" : "BILLING_OVERVIEW_LOAD_FAILED";
    return NextResponse.json({ success: false, code }, { status: code === "FORBIDDEN" ? 403 : 500 });
  }
}

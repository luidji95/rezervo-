import { NextResponse } from "next/server";

import { EntitlementError, resolveSalonEntitlements } from "@/features/billing/services/entitlementService";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizePlanCatalog, type PlanCatalogRow } from "@/features/billing/services/planCatalog";
import { isBillingCustomerPortalConfigured } from "@/features/billing/customerPortal/billingCustomerPortalConfig";
import { canOpenCustomerPortal } from "@/features/billing/customerPortal/billingCustomerPortalCore";
import type { BillingEnvironment } from "@/features/billing/config/billingEnvironment";
import { getBillingCheckoutConfig } from "@/features/billing/services/billingCheckoutConfig";
import { canOfferNewCheckout } from "@/features/billing/services/billingCheckoutEligibility";

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
    const entitlements = await resolveSalonEntitlements({ authenticatedUserId: auth.user.id, salonId });
    const [{ count, error }, { data: plans, error: plansError }, { data: subscription, error: subscriptionError }] = await Promise.all([
      supabaseServer.from("employees").select("id", { count: "exact", head: true }).eq("salon_id", salonId).eq("is_active", true),
      supabaseServer.from("plans").select("slug, name, monthly_price, yearly_price, currency, max_employees, is_active").in("slug", ["starter", "pro", "premium"]).order("sort_order"),
      supabaseServer.from("subscriptions").select("status,billing_provider,billing_environment,provider_subscription_id,provider_customer_id,trial_starts_at,trial_ends_at").eq("salon_id", salonId).maybeSingle(),
    ]);
    if (error || plansError || subscriptionError) throw error ?? plansError ?? subscriptionError;
    const catalog = normalizePlanCatalog((plans ?? []) as unknown as PlanCatalogRow[]);
    if (catalog.length !== 3) throw new Error("PLAN_CATALOG_INCOMPLETE");
    let checkoutConfigured = false;
    let databaseEnvironmentMatches = false;
    let hasCompletedCheckout = true;
    try {
      const config = getBillingCheckoutConfig();
      const { data: environmentMatches, error: environmentError } = await supabaseServer
        .rpc("billing_environment_matches_v1", { p_environment: config.environment });
      databaseEnvironmentMatches = !environmentError && environmentMatches === true;
      const { count: completed, error: completedError } = await supabaseServer
        .from("billing_checkout_sessions").select("id", { count: "exact", head: true })
        .eq("salon_id", salonId).eq("provider", "lemonsqueezy")
        .eq("environment", config.environment).eq("status", "completed");
      checkoutConfigured = !completedError && (config.environment === "test" ||
        config.liveAllowedSalonIds?.has(salonId) === true);
      hasCompletedCheckout = completed === null || completed > 0;
    } catch {
      // Checkout configuration does not prevent read-only billing overview.
    }
    const canStartCheckout = canOfferNewCheckout({
      isOwner: salon.owner_id === auth.user.id,
      configured: checkoutConfigured,
      databaseEnvironmentMatches,
      isBillingExempt: entitlements.isBillingExempt,
      hasCompletedCheckout,
      subscription: subscription ? { ...subscription, planCode: entitlements.subscriptionPlanCode } : null,
    });
    const canOpen = canOpenCustomerPortal({
      isOwner: salon.owner_id === auth.user.id,
      configured: isBillingCustomerPortalConfigured(process.env),
      subscription: subscription ? {
        provider: subscription.billing_provider as "lemonsqueezy",
        environment: subscription.billing_environment as BillingEnvironment,
        providerSubscriptionId: subscription.provider_subscription_id ?? "",
        providerCustomerId: subscription.provider_customer_id ?? "",
        status: subscription.status,
      } : null,
    });
    return NextResponse.json({ success: true, usage: { activeEmployees: count ?? 0 }, plans: catalog, canOpenCustomerPortal: canOpen, canStartCheckout }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof EntitlementError ? error.code : "BILLING_OVERVIEW_LOAD_FAILED";
    return NextResponse.json({ success: false, code }, { status: code === "FORBIDDEN" ? 403 : 500 });
  }
}

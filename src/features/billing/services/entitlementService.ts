import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import type { SalonEntitlements } from "../types/entitlements";

export type EntitlementErrorCode =
  | "FORBIDDEN"
  | "ENTITLEMENTS_NOT_CONFIGURED"
  | "ENTITLEMENT_REQUIRED"
  | "EMPLOYEE_LIMIT_REACHED";

export class EntitlementError extends Error {
  constructor(public readonly code: EntitlementErrorCode) {
    super(code);
    this.name = "EntitlementError";
  }
}

type PlanRow = {
  name: string;
  slug: string;
  analytics_enabled: boolean;
  ai_receptionist_enabled: boolean;
  whatsapp_enabled: boolean;
  instagram_enabled: boolean;
  marketing_enabled: boolean;
  sms_reminders_enabled: boolean;
  max_employees: number | null;
  max_monthly_bookings: number | null;
  max_ai_messages: number | null;
  max_monthly_reminders: number | null;
};

type SubscriptionRow = {
  status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  plans: PlanRow | PlanRow[] | null;
};

function normalizeStatus(row: SubscriptionRow): SalonEntitlements["subscriptionStatus"] {
  const now = Date.now();
  if (row.status === "trialing" && row.trial_ends_at && Date.parse(row.trial_ends_at) <= now) {
    return "expired";
  }
  if (row.status === "active" && row.current_period_ends_at && Date.parse(row.current_period_ends_at) <= now) {
    return "expired";
  }
  if (row.status === "canceled" || row.status === "cancelled") return "cancelled";
  if (["trialing", "active", "past_due", "expired"].includes(row.status)) {
    return row.status as SalonEntitlements["subscriptionStatus"];
  }
  return "expired";
}

export async function resolveSalonEntitlements({
  authenticatedUserId,
  salonId,
}: {
  authenticatedUserId: string;
  salonId: string;
}): Promise<SalonEntitlements> {
  const [{ data: salon, error: salonError }, { data: membership, error: membershipError }] =
    await Promise.all([
      supabaseServer.from("salons").select("id, owner_id").eq("id", salonId).maybeSingle(),
      supabaseServer
        .from("salon_members")
        .select("id")
        .eq("salon_id", salonId)
        .eq("profile_id", authenticatedUserId)
        .eq("status", "active")
        .maybeSingle(),
    ]);

  if (salonError || membershipError) throw new EntitlementError("ENTITLEMENTS_NOT_CONFIGURED");
  if (!salon || (salon.owner_id !== authenticatedUserId && !membership)) {
    throw new EntitlementError("FORBIDDEN");
  }

  const { data, error } = await supabaseServer
    .from("subscriptions")
    .select(`status, trial_ends_at, current_period_ends_at, plans!inner(
      name, slug, analytics_enabled, ai_receptionist_enabled, whatsapp_enabled,
      instagram_enabled, marketing_enabled, max_employees,
      max_monthly_bookings, max_ai_messages, sms_reminders_enabled,
      max_monthly_reminders
    )`)
    .eq("salon_id", salonId)
    .maybeSingle();

  if (error || !data) throw new EntitlementError("ENTITLEMENTS_NOT_CONFIGURED");
  const row = data as unknown as SubscriptionRow;
  const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans;
  if (!plan || !["starter", "pro", "premium"].includes(plan.slug)) {
    throw new EntitlementError("ENTITLEMENTS_NOT_CONFIGURED");
  }

  return {
    planCode: plan.slug as SalonEntitlements["planCode"],
    planName: plan.name,
    subscriptionStatus: normalizeStatus(row),
    canUseStatistics: plan.analytics_enabled,
    canUseAiReceptionist: plan.ai_receptionist_enabled,
    canUseWhatsApp: plan.whatsapp_enabled,
    canUseInstagram: plan.instagram_enabled,
    canUseMarketing: plan.marketing_enabled,
    canUseSmsReminders: plan.sms_reminders_enabled,
    maxEmployees: plan.max_employees,
    maxMonthlyBookings: plan.max_monthly_bookings,
    maxAiMessages: plan.max_ai_messages,
    maxMonthlyReminders: plan.max_monthly_reminders,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEndsAt: row.current_period_ends_at,
  };
}

export async function requireSalonEntitlement(
  input: { authenticatedUserId: string; salonId: string },
  entitlement: "canUseStatistics" | "canUseSmsReminders",
) {
  const entitlements = await resolveSalonEntitlements(input);
  if (!entitlements[entitlement]) throw new EntitlementError("ENTITLEMENT_REQUIRED");
  return entitlements;
}

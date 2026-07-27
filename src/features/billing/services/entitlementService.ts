import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { canResolveSalonEntitlements, resolveSubscriptionAccess } from "./subscriptionAccess";
import { resolveEffectiveAccess } from "./billingOverrideAccess";
import type { BillingOverrideType, PlanCode, SalonEntitlements } from "../types/entitlements";

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
  is_active: boolean;
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

type BillingOverrideRow = {
  enabled: boolean;
  override_type: BillingOverrideType;
  starts_at: string;
  ends_at: string | null;
  plans: PlanRow | PlanRow[] | null;
};

function mapPlan(plan: PlanRow | null) {
  return plan
    ? {
        code: plan.slug as PlanCode,
        name: plan.name,
        isActive: plan.is_active,
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
      }
    : null;
}

export async function resolveSalonEntitlements({
  authenticatedUserId,
  salonId,
  now = new Date(),
}: {
  authenticatedUserId: string;
  salonId: string;
  now?: Date;
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
  if (!salon || !canResolveSalonEntitlements({
    authenticatedUserId,
    ownerId: salon.owner_id,
    hasActiveMembership: Boolean(membership),
  })) {
    throw new EntitlementError("FORBIDDEN");
  }

  const [{ data, error }, { data: overrideData, error: overrideError }] = await Promise.all([
    supabaseServer
      .from("subscriptions")
      .select(`status, trial_ends_at, current_period_ends_at, plans(
        name, slug, is_active, analytics_enabled, ai_receptionist_enabled,
        whatsapp_enabled, instagram_enabled, marketing_enabled, max_employees,
        max_monthly_bookings, max_ai_messages, sms_reminders_enabled,
        max_monthly_reminders
      )`)
      .eq("salon_id", salonId)
      .maybeSingle(),
    supabaseServer
      .from("billing_access_overrides")
      .select(`enabled, override_type, starts_at, ends_at, plans(
        name, slug, is_active, analytics_enabled, ai_receptionist_enabled,
        whatsapp_enabled, instagram_enabled, marketing_enabled, max_employees,
        max_monthly_bookings, max_ai_messages, sms_reminders_enabled,
        max_monthly_reminders
      )`)
      .eq("salon_id", salonId)
      .maybeSingle(),
  ]);

  if (error || overrideError) throw new EntitlementError("ENTITLEMENTS_NOT_CONFIGURED");
  const row = data as unknown as SubscriptionRow | null;
  const candidatePlan = row ? (Array.isArray(row.plans) ? row.plans[0] : row.plans) : null;
  const plan = candidatePlan && ["starter", "pro", "premium"].includes(candidatePlan.slug)
    ? candidatePlan
    : null;

  const subscriptionAccess = resolveSubscriptionAccess({
    subscription: row
      ? { status: row.status, trialEndsAt: row.trial_ends_at, currentPeriodEndsAt: row.current_period_ends_at }
      : null,
    plan: mapPlan(plan),
    now,
  });

  const overrideRow = overrideData as unknown as BillingOverrideRow | null;
  const overrideCandidatePlan = overrideRow
    ? (Array.isArray(overrideRow.plans) ? overrideRow.plans[0] : overrideRow.plans)
    : null;
  const overridePlan = overrideCandidatePlan && ["starter", "pro", "premium"].includes(overrideCandidatePlan.slug)
    ? overrideCandidatePlan
    : null;

  return resolveEffectiveAccess({
    subscriptionAccess,
    billingOverride: overrideRow
      ? {
          enabled: overrideRow.enabled,
          overrideType: overrideRow.override_type,
          startsAt: overrideRow.starts_at,
          endsAt: overrideRow.ends_at,
        }
      : null,
    overridePlan: mapPlan(overridePlan),
    now,
  });
}

export async function requireSalonEntitlement(
  input: { authenticatedUserId: string; salonId: string },
  entitlement: "canUseStatistics" | "canUseSmsReminders",
) {
  const entitlements = await resolveSalonEntitlements(input);
  if (!entitlements.effectiveCapabilities[entitlement]) {
    throw new EntitlementError("ENTITLEMENT_REQUIRED");
  }
  return entitlements;
}

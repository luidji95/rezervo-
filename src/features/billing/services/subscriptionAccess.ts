import type {
  EffectiveCapabilities,
  PlanCapabilities,
  PlanCode,
  SalonEntitlements,
  SubscriptionAccessMode,
  SubscriptionAccessReason,
  SubscriptionStatus,
} from "../types/entitlements";

export type SubscriptionAccessPlan = PlanCapabilities & {
  code: PlanCode;
  name: string;
  isActive: boolean;
};

export type SubscriptionAccessRecord = {
  status: string;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  billingProvider: string | null;
  billingEnvironment: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
};

export type ResolveSubscriptionAccessInput = {
  subscription: SubscriptionAccessRecord | null;
  plan: SubscriptionAccessPlan | null;
  trustedEnvironment: "test" | "live";
  now: Date;
};

export function canResolveSalonEntitlements(input: {
  authenticatedUserId: string;
  ownerId: string;
  hasActiveMembership: boolean;
}): boolean {
  return input.ownerId === input.authenticatedUserId || input.hasActiveMembership;
}

type LifecycleAccess = {
  rawSubscriptionStatus: SubscriptionStatus | null;
  accessMode: SubscriptionAccessMode;
  accessReason: SubscriptionAccessReason;
  accessEndsAt: string | null;
  isLegacyActive: boolean;
};

const EMPTY_PLAN_CAPABILITIES: PlanCapabilities = {
  canUseStatistics: false,
  canUseAiReceptionist: false,
  canUseWhatsApp: false,
  canUseInstagram: false,
  canUseMarketing: false,
  canUseSmsReminders: false,
  maxEmployees: null,
  maxMonthlyBookings: null,
  maxAiMessages: null,
  maxMonthlyReminders: null,
};

function normalizeRawStatus(status: string): SubscriptionStatus {
  if (status === "canceled") return "cancelled";
  if (["trialing", "active", "past_due", "cancelled", "expired"].includes(status)) {
    return status as SubscriptionStatus;
  }
  return "expired";
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function hasTrustedSubscriptionAuthority(
  subscription: SubscriptionAccessRecord,
  trustedEnvironment: "test" | "live",
) {
  const providerFreeTrial =
    subscription.status === "trialing" &&
    subscription.billingProvider === null &&
    subscription.billingEnvironment === null &&
    subscription.providerCustomerId === null &&
    subscription.providerSubscriptionId === null;
  if (providerFreeTrial) return true;

  return subscription.billingProvider === "lemonsqueezy" &&
    subscription.billingEnvironment === trustedEnvironment &&
    Boolean(subscription.providerCustomerId?.trim()) &&
    Boolean(subscription.providerSubscriptionId?.trim());
}

function resolveLifecycle(
  subscription: SubscriptionAccessRecord | null,
  nowMs: number,
): LifecycleAccess {
  if (!subscription) {
    return {
      rawSubscriptionStatus: null,
      accessMode: "read_only",
      accessReason: "subscription_missing",
      accessEndsAt: null,
      isLegacyActive: false,
    };
  }

  const status = normalizeRawStatus(subscription.status);
  if (status === "trialing") {
    const endsAt = subscription.trialEndsAt;
    if (!endsAt || !isValidDate(endsAt)) {
      return { rawSubscriptionStatus: status, accessMode: "read_only", accessReason: "invalid_trial_period", accessEndsAt: endsAt, isLegacyActive: false };
    }
    return Date.parse(endsAt) > nowMs
      ? { rawSubscriptionStatus: status, accessMode: "full", accessReason: "active_trial", accessEndsAt: endsAt, isLegacyActive: false }
      : { rawSubscriptionStatus: status, accessMode: "read_only", accessReason: "trial_expired", accessEndsAt: endsAt, isLegacyActive: false };
  }

  if (status === "active") {
    const endsAt = subscription.currentPeriodEndsAt;
    if (endsAt === null) {
      return { rawSubscriptionStatus: status, accessMode: "full", accessReason: "legacy_active_no_period", accessEndsAt: null, isLegacyActive: true };
    }
    if (!isValidDate(endsAt)) {
      return { rawSubscriptionStatus: status, accessMode: "read_only", accessReason: "invalid_period", accessEndsAt: endsAt, isLegacyActive: false };
    }
    return Date.parse(endsAt) > nowMs
      ? { rawSubscriptionStatus: status, accessMode: "full", accessReason: "active_period", accessEndsAt: endsAt, isLegacyActive: false }
      : { rawSubscriptionStatus: status, accessMode: "read_only", accessReason: "period_expired", accessEndsAt: endsAt, isLegacyActive: false };
  }

  if (status === "cancelled") {
    const endsAt = subscription.currentPeriodEndsAt;
    if (endsAt && isValidDate(endsAt) && Date.parse(endsAt) > nowMs) {
      return { rawSubscriptionStatus: status, accessMode: "full", accessReason: "cancelled_until_period_end", accessEndsAt: endsAt, isLegacyActive: false };
    }
    return { rawSubscriptionStatus: status, accessMode: "read_only", accessReason: "cancelled", accessEndsAt: endsAt, isLegacyActive: false };
  }

  return {
    rawSubscriptionStatus: status,
    accessMode: "read_only",
    accessReason: status === "past_due" ? "past_due" : "expired",
    accessEndsAt: subscription.currentPeriodEndsAt,
    isLegacyActive: false,
  };
}

function effectiveCapabilities(
  accessMode: SubscriptionAccessMode,
  plan: PlanCapabilities,
): EffectiveCapabilities {
  const full = accessMode === "full";
  return {
    canUseStatistics: full && plan.canUseStatistics,
    canUseAiReceptionist: full && plan.canUseAiReceptionist,
    canUseWhatsApp: full && plan.canUseWhatsApp,
    canUseInstagram: full && plan.canUseInstagram,
    canUseMarketing: full && plan.canUseMarketing,
    canUseSmsReminders: full && plan.canUseSmsReminders,
    canCreateEmployees: full,
    canCreateAppointments: full,
    canUsePublicBooking: full,
    canManageBusinessData: full,
  };
}

export function resolveSubscriptionAccess({
  subscription,
  plan,
  trustedEnvironment,
  now,
}: ResolveSubscriptionAccessInput): SalonEntitlements {
  const trustedSubscription = subscription &&
    hasTrustedSubscriptionAuthority(subscription, trustedEnvironment)
    ? subscription
    : null;
  const lifecycle = resolveLifecycle(trustedSubscription, now.getTime());
  const authorityMismatch = Boolean(subscription && !trustedSubscription);
  const accessReason = subscription && !plan
    ? "plan_missing"
    : authorityMismatch
      ? "billing_environment_mismatch"
      : lifecycle.accessReason;
  const accessMode: SubscriptionAccessMode = subscription && plan && !authorityMismatch
    ? lifecycle.accessMode
    : "read_only";
  const planCapabilities: PlanCapabilities = plan
    ? {
        canUseStatistics: plan.canUseStatistics,
        canUseAiReceptionist: plan.canUseAiReceptionist,
        canUseWhatsApp: plan.canUseWhatsApp,
        canUseInstagram: plan.canUseInstagram,
        canUseMarketing: plan.canUseMarketing,
        canUseSmsReminders: plan.canUseSmsReminders,
        maxEmployees: plan.maxEmployees,
        maxMonthlyBookings: plan.maxMonthlyBookings,
        maxAiMessages: plan.maxAiMessages,
        maxMonthlyReminders: plan.maxMonthlyReminders,
      }
    : EMPTY_PLAN_CAPABILITIES;
  const effective = effectiveCapabilities(accessMode, planCapabilities);
  const displayStatus: SubscriptionStatus =
    accessReason === "trial_expired" || accessReason === "invalid_trial_period" || accessReason === "period_expired" || accessReason === "invalid_period" || accessReason === "subscription_missing" || accessReason === "plan_missing"
      || accessReason === "billing_environment_mismatch"
      ? "expired"
      : lifecycle.rawSubscriptionStatus ?? "expired";

  return {
    planCode: plan?.code ?? null,
    planName: plan?.name ?? "Paket nije dostupan",
    rawSubscriptionStatus: lifecycle.rawSubscriptionStatus,
    accessSource: "subscription",
    accessMode,
    accessReason,
    hasActiveAccess: accessMode === "full",
    isReadOnly: accessMode === "read_only",
    accessEndsAt: lifecycle.accessEndsAt,
    isLegacyActive: lifecycle.isLegacyActive && Boolean(plan),
    requiresBillingMigration: lifecycle.isLegacyActive && Boolean(plan),
    isBillingExempt: false,
    overrideType: null,
    overrideEndsAt: null,
    effectivePlanCode: plan?.code ?? null,
    subscriptionPlanCode: plan?.code ?? null,
    planCapabilities,
    effectiveCapabilities: effective,
    subscriptionStatus: displayStatus,
    canUseStatistics: effective.canUseStatistics,
    canUseAiReceptionist: effective.canUseAiReceptionist,
    canUseWhatsApp: effective.canUseWhatsApp,
    canUseInstagram: effective.canUseInstagram,
    canUseMarketing: effective.canUseMarketing,
    canUseSmsReminders: effective.canUseSmsReminders,
    maxEmployees: planCapabilities.maxEmployees,
    maxMonthlyBookings: planCapabilities.maxMonthlyBookings,
    maxAiMessages: planCapabilities.maxAiMessages,
    maxMonthlyReminders: planCapabilities.maxMonthlyReminders,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    currentPeriodEndsAt: subscription?.currentPeriodEndsAt ?? null,
  };
}

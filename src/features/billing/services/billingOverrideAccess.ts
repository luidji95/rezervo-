import type {
  BillingOverrideType,
  SalonEntitlements,
} from "../types/entitlements";
import {
  resolveSubscriptionAccess,
  type SubscriptionAccessPlan,
} from "./subscriptionAccess.ts";

export type BillingOverrideRecord = {
  enabled: boolean;
  overrideType: BillingOverrideType;
  startsAt: string;
  endsAt: string | null;
};

export type BillingOverrideState =
  | "missing"
  | "disabled"
  | "scheduled"
  | "expired"
  | "active"
  | "invalid_period"
  | "plan_missing";

export function resolveBillingOverrideState(input: {
  billingOverride: BillingOverrideRecord | null;
  overridePlan: SubscriptionAccessPlan | null;
  now: Date;
}): BillingOverrideState {
  const { billingOverride, overridePlan, now } = input;
  if (!billingOverride) return "missing";
  if (!billingOverride.enabled) return "disabled";

  const startsAt = Date.parse(billingOverride.startsAt);
  const endsAt = billingOverride.endsAt === null ? null : Date.parse(billingOverride.endsAt);
  if (!Number.isFinite(startsAt) || (endsAt !== null && !Number.isFinite(endsAt))) {
    return "invalid_period";
  }
  if (startsAt > now.getTime()) return "scheduled";
  if (endsAt !== null && endsAt <= now.getTime()) return "expired";
  if (!overridePlan) return "plan_missing";
  return "active";
}

export function resolveEffectiveAccess(input: {
  subscriptionAccess: SalonEntitlements;
  billingOverride: BillingOverrideRecord | null;
  overridePlan: SubscriptionAccessPlan | null;
  now: Date;
}): SalonEntitlements {
  const state = resolveBillingOverrideState(input);
  if (state !== "active") {
    if (state !== "plan_missing") return input.subscriptionAccess;
    const failed = resolveSubscriptionAccess({ subscription: null, plan: null, now: input.now });
    return {
      ...failed,
      rawSubscriptionStatus: input.subscriptionAccess.rawSubscriptionStatus,
      subscriptionStatus: input.subscriptionAccess.subscriptionStatus,
      subscriptionPlanCode: input.subscriptionAccess.subscriptionPlanCode,
      trialEndsAt: input.subscriptionAccess.trialEndsAt,
      currentPeriodEndsAt: input.subscriptionAccess.currentPeriodEndsAt,
      accessReason: "plan_missing",
    };
  }

  const billingOverride = input.billingOverride!;
  const overridePlan = input.overridePlan!;
  const overrideAccess = resolveSubscriptionAccess({
    subscription: {
      status: "active",
      trialEndsAt: null,
      currentPeriodEndsAt: billingOverride.endsAt,
    },
    plan: overridePlan,
    now: input.now,
  });

  return {
    ...overrideAccess,
    rawSubscriptionStatus: input.subscriptionAccess.rawSubscriptionStatus,
    subscriptionStatus: input.subscriptionAccess.subscriptionStatus,
    trialEndsAt: input.subscriptionAccess.trialEndsAt,
    currentPeriodEndsAt: input.subscriptionAccess.currentPeriodEndsAt,
    accessSource: "billing_override",
    accessReason: "billing_override",
    accessEndsAt: billingOverride.endsAt,
    isLegacyActive: false,
    requiresBillingMigration: false,
    isBillingExempt: true,
    overrideType: billingOverride.overrideType,
    overrideEndsAt: billingOverride.endsAt,
    effectivePlanCode: overridePlan.code,
    subscriptionPlanCode: input.subscriptionAccess.planCode,
  };
}

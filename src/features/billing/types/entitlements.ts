export type PlanCode = "starter" | "pro" | "premium";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

export type SubscriptionAccessMode = "full" | "read_only";
export type AccessSource = "subscription" | "billing_override";
export type BillingOverrideType = "internal" | "pilot" | "complimentary" | "support";

export type SubscriptionAccessReason =
  | "active_trial"
  | "trial_expired"
  | "invalid_trial_period"
  | "active_period"
  | "legacy_active_no_period"
  | "period_expired"
  | "invalid_period"
  | "cancelled_until_period_end"
  | "cancelled"
  | "past_due"
  | "expired"
  | "billing_override"
  | "subscription_missing"
  | "plan_missing"
  | "billing_environment_mismatch";

export type PlanCapabilities = {
  canUseStatistics: boolean;
  canUseAiReceptionist: boolean;
  canUseWhatsApp: boolean;
  canUseInstagram: boolean;
  canUseMarketing: boolean;
  canUseSmsReminders: boolean;
  maxEmployees: number | null;
  maxMonthlyBookings: number | null;
  maxAiMessages: number | null;
  maxMonthlyReminders: number | null;
};

export type EffectiveCapabilities = {
  canUseStatistics: boolean;
  canUseAiReceptionist: boolean;
  canUseWhatsApp: boolean;
  canUseInstagram: boolean;
  canUseMarketing: boolean;
  canUseSmsReminders: boolean;
  canCreateEmployees: boolean;
  canCreateAppointments: boolean;
  canUsePublicBooking: boolean;
  canManageBusinessData: boolean;
};

export type SalonEntitlements = {
  planCode: PlanCode | null;
  planName: string;
  rawSubscriptionStatus: SubscriptionStatus | null;
  accessSource: AccessSource;
  accessMode: SubscriptionAccessMode;
  accessReason: SubscriptionAccessReason;
  hasActiveAccess: boolean;
  isReadOnly: boolean;
  accessEndsAt: string | null;
  isLegacyActive: boolean;
  requiresBillingMigration: boolean;
  isBillingExempt: boolean;
  overrideType: BillingOverrideType | null;
  overrideEndsAt: string | null;
  effectivePlanCode: PlanCode | null;
  subscriptionPlanCode: PlanCode | null;
  planCapabilities: PlanCapabilities;
  effectiveCapabilities: EffectiveCapabilities;

  /** @deprecated Use rawSubscriptionStatus and accessReason for lifecycle UI. */
  subscriptionStatus: SubscriptionStatus;
  /** @deprecated Use effectiveCapabilities.canUseStatistics. */
  canUseStatistics: boolean;
  /** @deprecated Use effectiveCapabilities.canUseAiReceptionist. */
  canUseAiReceptionist: boolean;
  /** @deprecated Use effectiveCapabilities.canUseWhatsApp. */
  canUseWhatsApp: boolean;
  /** @deprecated Use effectiveCapabilities.canUseInstagram. */
  canUseInstagram: boolean;
  /** @deprecated Use effectiveCapabilities.canUseMarketing. */
  canUseMarketing: boolean;
  /** @deprecated Use effectiveCapabilities.canUseSmsReminders. */
  canUseSmsReminders: boolean;
  /** @deprecated Use planCapabilities.maxEmployees. */
  maxEmployees: number | null;
  /** @deprecated Use planCapabilities.maxMonthlyBookings. */
  maxMonthlyBookings: number | null;
  /** @deprecated Use planCapabilities.maxAiMessages. */
  maxAiMessages: number | null;
  /** @deprecated Use planCapabilities.maxMonthlyReminders. */
  maxMonthlyReminders: number | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
};

export type BooleanSalonEntitlement = keyof EffectiveCapabilities;

export type BooleanPlanCapability = {
  [Key in keyof PlanCapabilities]: PlanCapabilities[Key] extends boolean ? Key : never;
}[keyof PlanCapabilities];

export type SalonEntitlements = {
  planCode: "starter" | "pro" | "premium";
  planName: string;
  subscriptionStatus:
    | "trialing"
    | "active"
    | "past_due"
    | "cancelled"
    | "expired";
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
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
};

export type BooleanSalonEntitlement = {
  [Key in keyof SalonEntitlements]: SalonEntitlements[Key] extends boolean
    ? Key
    : never;
}[keyof SalonEntitlements];

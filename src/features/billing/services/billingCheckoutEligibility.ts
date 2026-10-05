// Read-only presentation of migration 040's subscription guard.
// Acquisition remains authoritative and rechecks under database locks.
export function canOfferNewCheckout(input: {
  isOwner: boolean;
  configured: boolean;
  databaseEnvironmentMatches: boolean;
  isBillingExempt: boolean;
  hasCompletedCheckout: boolean;
  subscription: {
    status: string;
    billing_provider: string | null;
    billing_environment: string | null;
    provider_customer_id: string | null;
    provider_subscription_id: string | null;
    trial_starts_at: string | null;
    trial_ends_at: string | null;
    planCode: string | null;
  } | null;
}) {
  const s = input.subscription;
  return Boolean(input.isOwner && input.configured && input.databaseEnvironmentMatches === true && !input.isBillingExempt &&
    !input.hasCompletedCheckout && s && s.status === "trialing" && s.planCode === "pro" &&
    s.billing_provider === null && s.billing_environment === null &&
    s.provider_customer_id === null && s.provider_subscription_id === null &&
    s.trial_starts_at && s.trial_ends_at &&
    Date.parse(s.trial_ends_at) > Date.parse(s.trial_starts_at));
}

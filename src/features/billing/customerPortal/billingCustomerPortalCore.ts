import { BillingCustomerPortalError } from "./billingCustomerPortalErrors.ts";
import type { BillingEnvironment } from "../config/billingEnvironment.ts";

export type BillingCustomerPortalInput = {
  provider: "lemonsqueezy";
  environment: BillingEnvironment;
  providerSubscriptionId: string;
  providerCustomerId: string;
};

export type BillingCustomerPortalResult = { url: string };

export interface BillingCustomerPortalProvider {
  createCustomerPortal(input: BillingCustomerPortalInput): Promise<BillingCustomerPortalResult>;
}

export type PortalSubscription = BillingCustomerPortalInput & { status: string };

export interface BillingCustomerPortalRepository {
  findOwnerSubscription(userId: string): Promise<PortalSubscription | "forbidden" | null>;
}

/** Provider-linked subscription in a status the portal supports, regardless of environment or configuration. */
export function isPortalEligibleSubscription(subscription: Partial<PortalSubscription> | null) {
  return Boolean(subscription
    && subscription.provider === "lemonsqueezy"
    && ["active", "cancelled", "past_due"].includes(subscription.status ?? "")
    && subscription.providerSubscriptionId?.trim()
    && subscription.providerCustomerId?.trim());
}

export function canOpenCustomerPortal(input: {
  isOwner: boolean;
  configured: boolean;
  environment: BillingEnvironment;
  databaseEnvironmentMatches: boolean;
  subscription: Partial<PortalSubscription> | null;
}) {
  const subscription = input.subscription;
  return Boolean(input.isOwner && input.configured && input.databaseEnvironmentMatches === true && subscription
    && subscription.provider === "lemonsqueezy"
    && subscription.environment === input.environment
    && ["active", "cancelled", "past_due"].includes(subscription.status ?? "")
    && subscription.providerSubscriptionId?.trim()
    && subscription.providerCustomerId?.trim());
}

export async function openBillingCustomerPortal(input: {
  userId: string;
  repository: BillingCustomerPortalRepository;
  provider: BillingCustomerPortalProvider;
  environment: BillingEnvironment;
  databaseEnvironmentMatches: boolean;
}) {
  const subscription = await input.repository.findOwnerSubscription(input.userId);
  if (subscription === "forbidden") throw new BillingCustomerPortalError("BILLING_PORTAL_FORBIDDEN", 403);
  if (!subscription || !canOpenCustomerPortal({ isOwner: true, configured: true, environment: input.environment, databaseEnvironmentMatches: input.databaseEnvironmentMatches, subscription })) {
    throw new BillingCustomerPortalError("BILLING_PORTAL_SUBSCRIPTION_UNAVAILABLE", 409);
  }
  return input.provider.createCustomerPortal(subscription);
}

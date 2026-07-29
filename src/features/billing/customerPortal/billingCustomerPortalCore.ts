import { BillingCustomerPortalError } from "./billingCustomerPortalErrors.ts";

export type BillingCustomerPortalInput = {
  provider: "lemonsqueezy";
  environment: "test";
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

export function canOpenCustomerPortal(input: {
  isOwner: boolean;
  configured: boolean;
  subscription: Partial<PortalSubscription> | null;
}) {
  const subscription = input.subscription;
  return Boolean(input.isOwner && input.configured && subscription
    && subscription.provider === "lemonsqueezy"
    && subscription.environment === "test"
    && ["active", "cancelled", "past_due"].includes(subscription.status ?? "")
    && subscription.providerSubscriptionId?.trim()
    && subscription.providerCustomerId?.trim());
}

export async function openBillingCustomerPortal(input: {
  userId: string;
  repository: BillingCustomerPortalRepository;
  provider: BillingCustomerPortalProvider;
}) {
  const subscription = await input.repository.findOwnerSubscription(input.userId);
  if (subscription === "forbidden") throw new BillingCustomerPortalError("BILLING_PORTAL_FORBIDDEN", 403);
  if (!subscription || !canOpenCustomerPortal({ isOwner: true, configured: true, subscription })) {
    throw new BillingCustomerPortalError("BILLING_PORTAL_SUBSCRIPTION_UNAVAILABLE", 409);
  }
  return input.provider.createCustomerPortal(subscription);
}

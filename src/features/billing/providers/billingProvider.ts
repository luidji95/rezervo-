import type { BillingEnvironment } from "../config/billingEnvironment.ts";

export type { BillingEnvironment } from "../config/billingEnvironment.ts";
export type BillingProviderName = "lemonsqueezy";
export type BillingInterval = "monthly";
export type CheckoutPlanCode = "starter" | "pro";

export type CreateCheckoutSessionInput = {
  checkoutSessionId: string;
  salonId: string;
  actorProfileId: string;
  planCode: CheckoutPlanCode;
  billingInterval: BillingInterval;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  environment: BillingEnvironment;
  providerStoreId: string;
  providerVariantId: string;
  expiresAt: string;
};

export type CreateCheckoutSessionResult = {
  provider: BillingProviderName;
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt: string;
  environment: BillingEnvironment;
};

export interface BillingProvider {
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult>;
}

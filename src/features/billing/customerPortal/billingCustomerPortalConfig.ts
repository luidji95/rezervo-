import "server-only";

import { BillingCustomerPortalError } from "./billingCustomerPortalErrors";
import { isBillingCustomerPortalConfigured, parsePortalAllowedHosts } from "./billingCustomerPortalConfigCore";
export { isBillingCustomerPortalConfigured } from "./billingCustomerPortalConfigCore";

export type BillingCustomerPortalConfig = {
  provider: "lemonsqueezy";
  environment: "test";
  apiKey: string;
  storeId: string;
  allowedHosts: ReadonlySet<string>;
};

export function getBillingCustomerPortalConfig(): BillingCustomerPortalConfig {
  if (!isBillingCustomerPortalConfigured(process.env)) throw new BillingCustomerPortalError("BILLING_PORTAL_DISABLED", 503);
  return {
    provider: "lemonsqueezy",
    environment: "test",
    apiKey: process.env.LEMONSQUEEZY_API_KEY!.trim(),
    storeId: process.env.LEMONSQUEEZY_STORE_ID!.trim(),
    allowedHosts: parsePortalAllowedHosts(process.env.LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS)!,
  };
}

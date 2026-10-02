import "server-only";

import { BillingCustomerPortalError } from "./billingCustomerPortalErrors";
import { resolveBillingCustomerPortalConfig } from "./billingCustomerPortalConfigCore";
export { isBillingCustomerPortalConfigured } from "./billingCustomerPortalConfigCore";

export type BillingCustomerPortalConfig = {
  provider: "lemonsqueezy";
  environment: "test";
  apiKey: string;
  storeId: string;
  allowedHosts: ReadonlySet<string>;
};

export function getBillingCustomerPortalConfig(): BillingCustomerPortalConfig {
  const config = resolveBillingCustomerPortalConfig(process.env);
  if (!config) throw new BillingCustomerPortalError("BILLING_PORTAL_DISABLED", 503);
  return config;
}

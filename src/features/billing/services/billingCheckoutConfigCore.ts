import { resolveLemonSqueezyProviderConfig } from "../config/lemonSqueezyProviderConfigCore.ts";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";

export type BillingCheckoutConfig = {
  enabled: true;
  provider: "lemonsqueezy";
  environment: "test";
  apiKey: string;
  storeId: string;
  appUrl: string;
};

type BillingCheckoutEnvironment = Record<string, string | undefined>;

function validAppUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export function resolveBillingCheckoutConfig(
  environment: BillingCheckoutEnvironment,
  appUrl: string,
): BillingCheckoutConfig {
  if (environment.BILLING_CHECKOUT_ENABLED !== "true") {
    throw new BillingCheckoutError("BILLING_CHECKOUT_DISABLED", 404);
  }
  let providerConfig;
  try {
    providerConfig = resolveLemonSqueezyProviderConfig(environment, "test");
  } catch {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  if (!validAppUrl(appUrl)) {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  return {
    enabled: true,
    ...providerConfig,
    appUrl,
  };
}

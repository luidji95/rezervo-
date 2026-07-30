import { parseBillingEnvironment } from "../config/billingEnvironment.ts";
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
  let billingEnvironment;
  try {
    billingEnvironment = parseBillingEnvironment(
      environment.BILLING_ENVIRONMENT,
    );
  } catch {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  if (
    environment.BILLING_PROVIDER !== "lemonsqueezy" ||
    billingEnvironment !== "test"
  ) {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  const apiKey = environment.LEMONSQUEEZY_API_KEY?.trim();
  const storeId = environment.LEMONSQUEEZY_STORE_ID?.trim();
  if (!apiKey || !storeId || !/^\d+$/.test(storeId) || !validAppUrl(appUrl)) {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  return {
    enabled: true,
    provider: "lemonsqueezy",
    environment: "test",
    apiKey,
    storeId,
    appUrl,
  };
}

import "server-only";

import { getAppUrl } from "@/lib/appUrl";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors";

export type BillingCheckoutConfig = {
  enabled: true;
  provider: "lemonsqueezy";
  environment: "test";
  apiKey: string;
  storeId: string;
  appUrl: string;
};

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

export function getBillingCheckoutConfig(): BillingCheckoutConfig {
  if (process.env.BILLING_CHECKOUT_ENABLED !== "true") {
    throw new BillingCheckoutError("BILLING_CHECKOUT_DISABLED", 404);
  }
  if (
    process.env.BILLING_PROVIDER !== "lemonsqueezy" ||
    process.env.BILLING_ENVIRONMENT !== "test"
  ) {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  const apiKey = process.env.LEMONSQUEEZY_API_KEY?.trim();
  const storeId = process.env.LEMONSQUEEZY_STORE_ID?.trim();
  const appUrl = getAppUrl();
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

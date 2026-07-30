import { resolveLemonSqueezyProviderConfig } from "../config/lemonSqueezyProviderConfigCore.ts";
import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";

export type BillingCheckoutConfig = {
  enabled: true;
  provider: "lemonsqueezy";
  environment: BillingEnvironment;
  apiKey: string;
  storeId: string;
  appUrl: string;
  liveAllowedSalonIds: ReadonlySet<string> | null;
};

type BillingCheckoutEnvironment = Record<string, string | undefined>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validAppUrl(value: string, environment: BillingEnvironment) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (environment === "live") {
      return url.protocol === "https:" && url.hostname !== "localhost";
    }
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function parseLiveAllowedSalonIds(value: string | undefined) {
  if (!value) return null;
  const ids = value.split(",").map((id) => id.trim());
  if (ids.length === 0 || ids.some((id) => !UUID_PATTERN.test(id))) return null;
  return new Set(ids);
}

export function resolveBillingCheckoutConfig(
  environment: BillingCheckoutEnvironment,
  appUrl: string,
  trustedEnvironment: BillingEnvironment,
): BillingCheckoutConfig {
  const capabilityEnabled =
    trustedEnvironment === "test"
      ? environment.BILLING_CHECKOUT_ENABLED === "true"
      : environment.BILLING_LIVE_CHECKOUT_ENABLED === "true";
  if (!capabilityEnabled) {
    throw new BillingCheckoutError("BILLING_CHECKOUT_DISABLED", 404);
  }
  let providerConfig;
  try {
    providerConfig = resolveLemonSqueezyProviderConfig(
      environment,
      trustedEnvironment,
    );
  } catch {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  const liveAllowedSalonIds =
    trustedEnvironment === "live"
      ? parseLiveAllowedSalonIds(
          environment.BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS,
        )
      : null;
  if (
    !validAppUrl(appUrl, trustedEnvironment) ||
    (trustedEnvironment === "live" && !liveAllowedSalonIds)
  ) {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  return {
    enabled: true,
    ...providerConfig,
    appUrl,
    liveAllowedSalonIds,
  };
}

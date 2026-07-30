import {
  parseBillingEnvironment,
  type BillingEnvironment,
} from "./billingEnvironment.ts";

export type LemonSqueezyProviderEnvironment = Record<
  string,
  string | undefined
>;

export type LemonSqueezyProviderConfig<
  Environment extends BillingEnvironment = BillingEnvironment,
> = {
  provider: "lemonsqueezy";
  environment: Environment;
  apiKey: string;
  storeId: string;
};

export class LemonSqueezyProviderConfigError extends Error {
  readonly code = "LEMONSQUEEZY_PROVIDER_NOT_CONFIGURED" as const;

  constructor() {
    super("LEMONSQUEEZY_PROVIDER_NOT_CONFIGURED");
    this.name = "LemonSqueezyProviderConfigError";
  }
}

export function resolveLemonSqueezyProviderConfig<
  Environment extends BillingEnvironment,
>(
  runtimeEnvironment: LemonSqueezyProviderEnvironment,
  trustedEnvironment: Environment,
): LemonSqueezyProviderConfig<Environment> {
  let deployedEnvironment: BillingEnvironment;
  try {
    deployedEnvironment = parseBillingEnvironment(
      runtimeEnvironment.BILLING_ENVIRONMENT,
    );
  } catch {
    throw new LemonSqueezyProviderConfigError();
  }

  if (
    runtimeEnvironment.BILLING_PROVIDER !== "lemonsqueezy" ||
    deployedEnvironment !== trustedEnvironment
  ) {
    throw new LemonSqueezyProviderConfigError();
  }

  const apiKey =
    trustedEnvironment === "test"
      ? runtimeEnvironment.LEMONSQUEEZY_API_KEY?.trim()
      : runtimeEnvironment.LEMONSQUEEZY_LIVE_API_KEY?.trim();
  const storeId =
    trustedEnvironment === "test"
      ? runtimeEnvironment.LEMONSQUEEZY_STORE_ID?.trim()
      : runtimeEnvironment.LEMONSQUEEZY_LIVE_STORE_ID?.trim();

  if (!apiKey || !storeId || !/^\d+$/.test(storeId)) {
    throw new LemonSqueezyProviderConfigError();
  }

  return {
    provider: "lemonsqueezy",
    environment: trustedEnvironment,
    apiKey,
    storeId,
  };
}

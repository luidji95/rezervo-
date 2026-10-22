import { parseBillingEnvironment, type BillingEnvironment } from "../config/billingEnvironment.ts";
import { resolveLemonSqueezyProviderConfig } from "../config/lemonSqueezyProviderConfigCore.ts";

export type PlanChangeRuntimeEnvironment = Record<string, string | undefined>;

export type BillingPlanChangeConfig = {
  provider: "lemonsqueezy";
  environment: BillingEnvironment;
  apiKey: string;
  storeId: string;
};

/**
 * Default-off: the endpoint exists only with BILLING_PLAN_CHANGE_ENABLED === "true" and a complete
 * trusted Lemon Squeezy configuration for the deployed BILLING_ENVIRONMENT. Nothing in the request
 * can select the environment, store or provider.
 */
export function resolveBillingPlanChangeConfig(env: PlanChangeRuntimeEnvironment): BillingPlanChangeConfig | null {
  if (env.BILLING_PLAN_CHANGE_ENABLED !== "true") return null;
  try {
    return resolveLemonSqueezyProviderConfig(env, parseBillingEnvironment(env.BILLING_ENVIRONMENT));
  } catch {
    return null;
  }
}

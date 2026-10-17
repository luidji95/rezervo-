import { parseBillingEnvironment, type BillingEnvironment } from "../config/billingEnvironment.ts";
import { resolveLemonSqueezyProviderConfig } from "../config/lemonSqueezyProviderConfigCore.ts";

export type BillingRecoveryConfig = {
  environment: BillingEnvironment;
  apiKey: string;
  storeId: string;
};

export class BillingRecoveryConfigError extends Error {
  readonly code = "BILLING_RECOVERY_NOT_CONFIGURED" as const;
  constructor() { super("BILLING_RECOVERY_NOT_CONFIGURED"); this.name = "BillingRecoveryConfigError"; }
}

/**
 * Operator recovery is default-off and needs an explicit opt-in in the operator's own environment.
 * The environment is the deployment's trusted BILLING_ENVIRONMENT; it can never be passed on the
 * command line. Credentials are the environment-specific ones from the shared provider resolver,
 * with no test/live fallback.
 */
export function resolveBillingRecoveryConfig(env: Record<string, string | undefined>): BillingRecoveryConfig {
  if (env.BILLING_OPERATOR_RECOVERY_ENABLED !== "true") throw new BillingRecoveryConfigError();
  try {
    const provider = resolveLemonSqueezyProviderConfig(env, parseBillingEnvironment(env.BILLING_ENVIRONMENT));
    return { environment: provider.environment, apiKey: provider.apiKey, storeId: provider.storeId };
  } catch {
    throw new BillingRecoveryConfigError();
  }
}

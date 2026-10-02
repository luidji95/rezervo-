export type BillingEnvironment = "test" | "live";

export class BillingEnvironmentConfigError extends Error {
  readonly code = "BILLING_ENVIRONMENT_INVALID" as const;

  constructor() {
    super("BILLING_ENVIRONMENT_INVALID");
    this.name = "BillingEnvironmentConfigError";
  }
}

export function parseBillingEnvironment(
  value: string | undefined,
): BillingEnvironment {
  if (value === "test" || value === "live") return value;
  throw new BillingEnvironmentConfigError();
}

export function expectedLemonSqueezyTestMode(
  environment: BillingEnvironment,
): boolean {
  return environment === "test";
}

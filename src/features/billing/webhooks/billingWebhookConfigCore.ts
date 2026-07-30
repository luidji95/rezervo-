import { BillingWebhookError } from "./billingWebhookErrors.ts";
import { parseBillingEnvironment } from "../config/billingEnvironment.ts";

export type BillingWebhookEnvironment = {
  BILLING_WEBHOOKS_ENABLED?: string;
  BILLING_PROVIDER?: string;
  BILLING_ENVIRONMENT?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
};

export function resolveBillingWebhookConfig(
  environment: BillingWebhookEnvironment,
) {
  if (environment.BILLING_WEBHOOKS_ENABLED !== "true") {
    throw new BillingWebhookError("BILLING_WEBHOOK_DISABLED", 404);
  }
  let billingEnvironment;
  try {
    billingEnvironment = parseBillingEnvironment(
      environment.BILLING_ENVIRONMENT,
    );
  } catch {
    throw new BillingWebhookError("BILLING_WEBHOOK_NOT_CONFIGURED", 503);
  }
  if (
    environment.BILLING_PROVIDER !== "lemonsqueezy" ||
    billingEnvironment !== "test"
  ) {
    throw new BillingWebhookError("BILLING_WEBHOOK_NOT_CONFIGURED", 503);
  }
  const webhookSecret = environment.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new BillingWebhookError("BILLING_WEBHOOK_NOT_CONFIGURED", 503);
  }
  return {
    provider: "lemonsqueezy" as const,
    environment: "test" as const,
    webhookSecret,
  };
}

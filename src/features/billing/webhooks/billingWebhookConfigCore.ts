import { BillingWebhookError } from "./billingWebhookErrors.ts";
import {
  parseBillingEnvironment,
  type BillingEnvironment,
} from "../config/billingEnvironment.ts";

export type BillingWebhookEnvironment = {
  BILLING_WEBHOOKS_ENABLED?: string;
  BILLING_LIVE_WEBHOOKS_ENABLED?: string;
  BILLING_PROVIDER?: string;
  BILLING_ENVIRONMENT?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  LEMONSQUEEZY_LIVE_WEBHOOK_SECRET?: string;
};

export function resolveBillingWebhookConfig(
  runtimeEnvironment: BillingWebhookEnvironment,
  trustedEnvironment: BillingEnvironment,
) {
  const enabled =
    trustedEnvironment === "test"
      ? runtimeEnvironment.BILLING_WEBHOOKS_ENABLED
      : runtimeEnvironment.BILLING_LIVE_WEBHOOKS_ENABLED;
  if (enabled !== "true") {
    throw new BillingWebhookError("BILLING_WEBHOOK_DISABLED", 404);
  }
  let billingEnvironment;
  try {
    billingEnvironment = parseBillingEnvironment(
      runtimeEnvironment.BILLING_ENVIRONMENT,
    );
  } catch {
    throw new BillingWebhookError("BILLING_WEBHOOK_NOT_CONFIGURED", 503);
  }
  if (
    runtimeEnvironment.BILLING_PROVIDER !== "lemonsqueezy" ||
    billingEnvironment !== trustedEnvironment
  ) {
    throw new BillingWebhookError("BILLING_WEBHOOK_NOT_CONFIGURED", 503);
  }
  const webhookSecret =
    trustedEnvironment === "test"
      ? runtimeEnvironment.LEMONSQUEEZY_WEBHOOK_SECRET?.trim()
      : runtimeEnvironment.LEMONSQUEEZY_LIVE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new BillingWebhookError("BILLING_WEBHOOK_NOT_CONFIGURED", 503);
  }
  return {
    provider: "lemonsqueezy" as const,
    environment: trustedEnvironment,
    webhookSecret,
  };
}

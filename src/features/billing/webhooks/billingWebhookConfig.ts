import "server-only";

import type { BillingEnvironment } from "../config/billingEnvironment";
import { resolveBillingWebhookConfig } from "./billingWebhookConfigCore";

export function getBillingWebhookConfig(environment: BillingEnvironment) {
  return resolveBillingWebhookConfig(
    {
      BILLING_WEBHOOKS_ENABLED: process.env.BILLING_WEBHOOKS_ENABLED,
      BILLING_LIVE_WEBHOOKS_ENABLED:
        process.env.BILLING_LIVE_WEBHOOKS_ENABLED,
      BILLING_PROVIDER: process.env.BILLING_PROVIDER,
      BILLING_ENVIRONMENT: process.env.BILLING_ENVIRONMENT,
      LEMONSQUEEZY_WEBHOOK_SECRET:
        process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
      LEMONSQUEEZY_LIVE_WEBHOOK_SECRET:
        process.env.LEMONSQUEEZY_LIVE_WEBHOOK_SECRET,
    },
    environment,
  );
}

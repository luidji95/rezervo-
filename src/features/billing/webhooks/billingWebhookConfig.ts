import "server-only";

import { resolveBillingWebhookConfig } from "./billingWebhookConfigCore";

export function getBillingWebhookConfig() {
  return resolveBillingWebhookConfig({
    BILLING_WEBHOOKS_ENABLED: process.env.BILLING_WEBHOOKS_ENABLED,
    BILLING_PROVIDER: process.env.BILLING_PROVIDER,
    BILLING_ENVIRONMENT: process.env.BILLING_ENVIRONMENT,
    LEMONSQUEEZY_WEBHOOK_SECRET: process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
  });
}

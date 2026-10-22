import "server-only";

import { resolveBillingPlanChangeConfig, type BillingPlanChangeConfig } from "./billingPlanChangeConfigCore";

export type { BillingPlanChangeConfig } from "./billingPlanChangeConfigCore";

export function getBillingPlanChangeConfig(): BillingPlanChangeConfig | null {
  return resolveBillingPlanChangeConfig(process.env);
}

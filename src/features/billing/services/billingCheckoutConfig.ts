import "server-only";

import { getAppUrl } from "@/lib/appUrl";
import {
  resolveBillingCheckoutConfig,
  type BillingCheckoutConfig,
} from "./billingCheckoutConfigCore";

export type { BillingCheckoutConfig } from "./billingCheckoutConfigCore";

export function getBillingCheckoutConfig(): BillingCheckoutConfig {
  return resolveBillingCheckoutConfig(process.env, getAppUrl());
}

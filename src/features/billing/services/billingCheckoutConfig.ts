import "server-only";

import { getAppUrl } from "@/lib/appUrl";
import { parseBillingEnvironment } from "../config/billingEnvironment";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors";
import {
  resolveBillingCheckoutConfig,
  type BillingCheckoutConfig,
} from "./billingCheckoutConfigCore";

export type { BillingCheckoutConfig } from "./billingCheckoutConfigCore";

export function getBillingCheckoutConfig(): BillingCheckoutConfig {
  let trustedEnvironment;
  try {
    trustedEnvironment = parseBillingEnvironment(
      process.env.BILLING_ENVIRONMENT,
    );
  } catch {
    throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
  }
  return resolveBillingCheckoutConfig(
    process.env,
    getAppUrl(),
    trustedEnvironment,
  );
}

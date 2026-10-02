import "server-only";

import { parseBillingEnvironment } from "./billingEnvironment";

export function getTrustedBillingEnvironment() {
  return parseBillingEnvironment(process.env.BILLING_ENVIRONMENT);
}

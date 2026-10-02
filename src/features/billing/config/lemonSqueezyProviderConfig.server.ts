import "server-only";

import type { BillingEnvironment } from "./billingEnvironment";
import {
  resolveLemonSqueezyProviderConfig,
  type LemonSqueezyProviderConfig,
} from "./lemonSqueezyProviderConfigCore";

export function getLemonSqueezyProviderConfig(
  environment: BillingEnvironment,
): LemonSqueezyProviderConfig {
  return resolveLemonSqueezyProviderConfig(process.env, environment);
}

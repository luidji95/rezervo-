import { createHash, timingSafeEqual } from "node:crypto";

import {
  parseBillingEnvironment,
  type BillingEnvironment,
} from "../config/billingEnvironment.ts";
import {
  resolveLemonSqueezyProviderConfig,
  type LemonSqueezyProviderConfig,
} from "../config/lemonSqueezyProviderConfigCore.ts";
import { CHECKOUT_RECOVERY_MAX_PAGES } from "../providers/lemonSqueezyCheckoutRetrievalCore.ts";

export type BillingCheckoutRecoveryEnvironment = Record<string, string | undefined>;
export type BillingCheckoutRecoveryConfig = {
  enabled: true;
  environment: BillingEnvironment;
  secret: string;
  leaseSeconds: number;
  pageSize: number;
  maxPages: number;
  provider: LemonSqueezyProviderConfig;
};

export class BillingCheckoutRecoveryConfigError extends Error {
  readonly code = "BILLING_CHECKOUT_RECOVERY_DISABLED" as const;
  constructor() {
    super("BILLING_CHECKOUT_RECOVERY_DISABLED");
    this.name = "BillingCheckoutRecoveryConfigError";
  }
}

function exactInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const raw = value ?? String(fallback);
  if (!/^[1-9]\d*$/.test(raw)) throw new BillingCheckoutRecoveryConfigError();
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BillingCheckoutRecoveryConfigError();
  }
  return parsed;
}

export function resolveBillingCheckoutRecoveryConfig(
  runtimeEnvironment: BillingCheckoutRecoveryEnvironment,
  trustedEnvironment: BillingEnvironment,
): BillingCheckoutRecoveryConfig {
  let deployedEnvironment: BillingEnvironment;
  try {
    deployedEnvironment = parseBillingEnvironment(runtimeEnvironment.BILLING_ENVIRONMENT);
  } catch {
    throw new BillingCheckoutRecoveryConfigError();
  }
  if (runtimeEnvironment.BILLING_PROVIDER !== "lemonsqueezy" || deployedEnvironment !== trustedEnvironment) {
    throw new BillingCheckoutRecoveryConfigError();
  }

  const live = trustedEnvironment === "live";
  const enabled = live
    ? runtimeEnvironment.BILLING_LIVE_CHECKOUT_RECOVERY_ENABLED
    : runtimeEnvironment.BILLING_CHECKOUT_RECOVERY_ENABLED;
  const secret = (live
    ? runtimeEnvironment.BILLING_LIVE_CHECKOUT_RECOVERY_SECRET
    : runtimeEnvironment.BILLING_CHECKOUT_RECOVERY_SECRET)?.trim();
  if (enabled !== "true" || !secret) throw new BillingCheckoutRecoveryConfigError();

  const leaseSeconds = exactInteger(
    live
      ? runtimeEnvironment.BILLING_LIVE_CHECKOUT_RECOVERY_LEASE_SECONDS
      : runtimeEnvironment.BILLING_CHECKOUT_RECOVERY_LEASE_SECONDS,
    300,
    30,
    600,
  );
  const pageSize = exactInteger(
    live
      ? runtimeEnvironment.BILLING_LIVE_CHECKOUT_RECOVERY_PAGE_SIZE
      : runtimeEnvironment.BILLING_CHECKOUT_RECOVERY_PAGE_SIZE,
    live ? 25 : 50,
    1,
    100,
  );
  const maxPages = exactInteger(
    live
      ? runtimeEnvironment.BILLING_LIVE_CHECKOUT_RECOVERY_MAX_PAGES
      : runtimeEnvironment.BILLING_CHECKOUT_RECOVERY_MAX_PAGES,
    5,
    1,
    CHECKOUT_RECOVERY_MAX_PAGES,
  );

  let provider: LemonSqueezyProviderConfig;
  try {
    provider = resolveLemonSqueezyProviderConfig(runtimeEnvironment, trustedEnvironment);
  } catch {
    throw new BillingCheckoutRecoveryConfigError();
  }
  return { enabled: true, environment: trustedEnvironment, secret, leaseSeconds, pageSize, maxPages, provider };
}

export function verifyBillingCheckoutRecoveryAuthorization(
  authorization: string | null,
  expectedSecret: string,
) {
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (
    !supplied || !expectedSecret || !expectedSecret.trim() ||
    supplied !== supplied.trim()
  ) return false;
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(expectedSecret).digest(),
  );
}

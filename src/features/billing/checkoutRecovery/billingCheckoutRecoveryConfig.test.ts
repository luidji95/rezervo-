import assert from "node:assert/strict";
import test from "node:test";

import {
  BillingCheckoutRecoveryConfigError,
  resolveBillingCheckoutRecoveryConfig,
  verifyBillingCheckoutRecoveryAuthorization,
} from "./billingCheckoutRecoveryConfig.ts";

const base = {
  BILLING_PROVIDER: "lemonsqueezy",
  BILLING_ENVIRONMENT: "test",
  BILLING_CHECKOUT_RECOVERY_ENABLED: "true",
  BILLING_CHECKOUT_RECOVERY_SECRET: "test-recovery-secret",
  BILLING_CHECKOUT_RECOVERY_LEASE_SECONDS: "300",
  BILLING_CHECKOUT_RECOVERY_PAGE_SIZE: "50",
  BILLING_CHECKOUT_RECOVERY_MAX_PAGES: "5",
  LEMONSQUEEZY_API_KEY: "test-api-key",
  LEMONSQUEEZY_STORE_ID: "10",
};

test("test recovery resolves only test slots", () => {
  const config = resolveBillingCheckoutRecoveryConfig({
    ...base,
    BILLING_LIVE_CHECKOUT_RECOVERY_ENABLED: "true",
    BILLING_LIVE_CHECKOUT_RECOVERY_SECRET: "live-secret",
    LEMONSQUEEZY_LIVE_API_KEY: "live-key",
    LEMONSQUEEZY_LIVE_STORE_ID: "20",
  }, "test");
  assert.equal(config.environment, "test");
  assert.equal(config.secret, "test-recovery-secret");
  assert.equal(config.provider.apiKey, "test-api-key");
  assert.equal(config.provider.storeId, "10");
});

test("live recovery resolves only live slots", () => {
  const config = resolveBillingCheckoutRecoveryConfig({
    ...base,
    BILLING_ENVIRONMENT: "live",
    BILLING_LIVE_CHECKOUT_RECOVERY_ENABLED: "true",
    BILLING_LIVE_CHECKOUT_RECOVERY_SECRET: "live-secret",
    BILLING_LIVE_CHECKOUT_RECOVERY_LEASE_SECONDS: "300",
    BILLING_LIVE_CHECKOUT_RECOVERY_PAGE_SIZE: "25",
    BILLING_LIVE_CHECKOUT_RECOVERY_MAX_PAGES: "5",
    LEMONSQUEEZY_LIVE_API_KEY: "live-key",
    LEMONSQUEEZY_LIVE_STORE_ID: "20",
  }, "live");
  assert.equal(config.environment, "live");
  assert.equal(config.secret, "live-secret");
  assert.equal(config.provider.apiKey, "live-key");
  assert.equal(config.provider.storeId, "20");
});

test("flags, secrets and credentials never fall back across environments", () => {
  for (const [environment, trusted] of [
    [{ ...base, BILLING_ENVIRONMENT: "live" }, "live"],
    [{ ...base, BILLING_CHECKOUT_RECOVERY_ENABLED: undefined, BILLING_LIVE_CHECKOUT_RECOVERY_ENABLED: "true", BILLING_LIVE_CHECKOUT_RECOVERY_SECRET: "live" }, "test"],
  ] as const) {
    assert.throws(
      () => resolveBillingCheckoutRecoveryConfig(environment, trusted),
      BillingCheckoutRecoveryConfigError,
    );
  }
});

test("deployment authority and numeric bounds fail closed", () => {
  for (const overrides of [
    { BILLING_ENVIRONMENT: "live" },
    { BILLING_PROVIDER: "stripe" },
    { BILLING_CHECKOUT_RECOVERY_LEASE_SECONDS: "29" },
    { BILLING_CHECKOUT_RECOVERY_LEASE_SECONDS: "601" },
    { BILLING_CHECKOUT_RECOVERY_PAGE_SIZE: "101" },
    { BILLING_CHECKOUT_RECOVERY_MAX_PAGES: "11" },
    { BILLING_CHECKOUT_RECOVERY_MAX_PAGES: "01" },
  ]) assert.throws(() => resolveBillingCheckoutRecoveryConfig({ ...base, ...overrides }, "test"));
  const config = resolveBillingCheckoutRecoveryConfig({ ...base, NODE_ENV: "production", VERCEL_ENV: "production" }, "test");
  assert.equal(config.environment, "test");
});

test("Bearer verification is exact and timing-safe compatible", () => {
  assert.equal(verifyBillingCheckoutRecoveryAuthorization("Bearer secret", "secret"), true);
  for (const value of [null, "secret", "Basic secret", "Bearer wrong", "Bearer "]) {
    assert.equal(verifyBillingCheckoutRecoveryAuthorization(value, "secret"), false);
  }
});

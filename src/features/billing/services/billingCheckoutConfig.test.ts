import assert from "node:assert/strict";
import test from "node:test";

import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";
import { resolveBillingCheckoutConfig } from "./billingCheckoutConfigCore.ts";

const base = {
  BILLING_CHECKOUT_ENABLED: "true",
  BILLING_PROVIDER: "lemonsqueezy",
  BILLING_ENVIRONMENT: "test",
  LEMONSQUEEZY_API_KEY: "test-key",
  LEMONSQUEEZY_STORE_ID: "123",
};
const liveSalon = "20000000-0000-4000-8000-000000000002";

test("checkout config preserves the sandbox contract", () => {
  assert.deepEqual(
    resolveBillingCheckoutConfig(base, "https://sandbox.example.test", "test"),
    {
      enabled: true,
      provider: "lemonsqueezy",
      environment: "test",
      apiKey: "test-key",
      storeId: "123",
      appUrl: "https://sandbox.example.test",
      liveAllowedSalonIds: null,
    },
  );
});

test("live config requires its capability, credentials and pilot allowlist", () => {
  const live = {
    BILLING_LIVE_CHECKOUT_ENABLED: "true",
    BILLING_PROVIDER: "lemonsqueezy",
    BILLING_ENVIRONMENT: "live",
    LEMONSQUEEZY_LIVE_API_KEY: "live-key",
    LEMONSQUEEZY_LIVE_STORE_ID: "456",
    BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS: liveSalon,
  };
  const config = resolveBillingCheckoutConfig(
    live,
    "https://app.example.test",
    "live",
  );
  assert.equal(config.environment, "live");
  assert.equal(config.apiKey, "live-key");
  assert.equal(config.storeId, "456");
  assert.deepEqual([...config.liveAllowedSalonIds!], [liveSalon]);

  for (const patch of [
    { BILLING_LIVE_CHECKOUT_ENABLED: undefined },
    { LEMONSQUEEZY_LIVE_API_KEY: undefined },
    { LEMONSQUEEZY_LIVE_STORE_ID: undefined },
    { BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS: undefined },
    { BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS: "" },
    { BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS: "not-a-uuid" },
  ]) {
    assert.throws(() =>
      resolveBillingCheckoutConfig(
        { ...live, ...patch },
        "https://app.example.test",
        "live",
      ),
    );
  }
  for (const appUrl of ["http://localhost:3000", "https://localhost"]) {
    assert.throws(() =>
      resolveBillingCheckoutConfig(live, appUrl, "live"),
    );
  }
});

test("checkout flags and credentials never cross environments", () => {
  assert.throws(() =>
    resolveBillingCheckoutConfig(
      {
        ...base,
        BILLING_ENVIRONMENT: "live",
        BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS: liveSalon,
      },
      "https://app.example.test",
      "live",
    ),
  );
  assert.throws(() =>
    resolveBillingCheckoutConfig(
      {
        BILLING_LIVE_CHECKOUT_ENABLED: "true",
        BILLING_PROVIDER: "lemonsqueezy",
        BILLING_ENVIRONMENT: "test",
        LEMONSQUEEZY_LIVE_API_KEY: "live-key",
        LEMONSQUEEZY_LIVE_STORE_ID: "456",
      },
      "https://app.example.test",
      "test",
    ),
  );
  assert.throws(() =>
    resolveBillingCheckoutConfig(
      { ...base, BILLING_ENVIRONMENT: "test" },
      "https://app.example.test",
      "live",
    ),
  );
  assert.throws(() =>
    resolveBillingCheckoutConfig(
      {
        ...base,
        BILLING_ENVIRONMENT: "live",
        BILLING_LIVE_CHECKOUT_ENABLED: "true",
        LEMONSQUEEZY_LIVE_API_KEY: "live-key",
        LEMONSQUEEZY_LIVE_STORE_ID: "456",
        BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS: liveSalon,
      },
      "https://app.example.test",
      "test",
    ),
  );
});

test("test checkout ignores live pilot configuration", () => {
  const config = resolveBillingCheckoutConfig(
    {
      ...base,
      BILLING_LIVE_CHECKOUT_ENABLED: "true",
      LEMONSQUEEZY_LIVE_API_KEY: "live-key",
      LEMONSQUEEZY_LIVE_STORE_ID: "456",
      BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS: "invalid",
    },
    "https://sandbox.example.test",
    "test",
  );
  assert.equal(config.environment, "test");
  assert.equal(config.liveAllowedSalonIds, null);
});

test("checkout does not use live credentials as a test fallback", () => {
  assert.throws(
    () =>
      resolveBillingCheckoutConfig(
        {
          BILLING_CHECKOUT_ENABLED: "true",
          BILLING_PROVIDER: "lemonsqueezy",
          BILLING_ENVIRONMENT: "test",
          LEMONSQUEEZY_LIVE_API_KEY: "live-key",
          LEMONSQUEEZY_LIVE_STORE_ID: "456",
        },
        "https://app.example.test",
        "test",
      ),
    (error) =>
      error instanceof BillingCheckoutError &&
      error.code === "BILLING_NOT_CONFIGURED",
  );
});

test("checkout config fails closed for missing and unknown environments", () => {
  for (const value of [undefined, "production"]) {
    assert.throws(
      () =>
        resolveBillingCheckoutConfig(
          { ...base, BILLING_ENVIRONMENT: value },
          "https://app.example.test",
          "test",
        ),
      (error) =>
        error instanceof BillingCheckoutError &&
        error.code === "BILLING_NOT_CONFIGURED",
    );
  }
});

test("checkout config never derives billing environment from runtime aliases", () => {
  assert.throws(() =>
    resolveBillingCheckoutConfig(
      {
        ...base,
        BILLING_ENVIRONMENT: undefined,
        NODE_ENV: "test",
        VERCEL_ENV: "preview",
      },
      "https://app.example.test",
      "test",
    ),
  );
});

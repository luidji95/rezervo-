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

test("checkout config preserves the sandbox contract", () => {
  assert.deepEqual(
    resolveBillingCheckoutConfig(base, "https://sandbox.example.test"),
    {
      enabled: true,
      provider: "lemonsqueezy",
      environment: "test",
      apiKey: "test-key",
      storeId: "123",
      appUrl: "https://sandbox.example.test",
    },
  );
});

test("checkout config recognizes but does not enable live billing", () => {
  assert.throws(
    () =>
      resolveBillingCheckoutConfig(
        {
          ...base,
          BILLING_ENVIRONMENT: "live",
          LEMONSQUEEZY_LIVE_API_KEY: "live-key",
          LEMONSQUEEZY_LIVE_STORE_ID: "456",
        },
        "https://app.example.test",
      ),
    (error) =>
      error instanceof BillingCheckoutError &&
      error.code === "BILLING_NOT_CONFIGURED",
  );
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
    ),
  );
});

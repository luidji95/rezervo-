import assert from "node:assert/strict";
import test from "node:test";

import {
  BillingEnvironmentConfigError,
  expectedLemonSqueezyTestMode,
  parseBillingEnvironment,
} from "./billingEnvironment.ts";

test("parseBillingEnvironment accepts only canonical test and live values", () => {
  assert.equal(parseBillingEnvironment("test"), "test");
  assert.equal(parseBillingEnvironment("live"), "live");
});

test("parseBillingEnvironment rejects missing or non-canonical values", () => {
  for (const value of [
    undefined,
    "",
    " ",
    "TEST",
    "Live",
    "production",
    "sandbox",
    "test ",
    " live",
  ]) {
    assert.throws(
      () => parseBillingEnvironment(value),
      (error) =>
        error instanceof BillingEnvironmentConfigError &&
        error.code === "BILLING_ENVIRONMENT_INVALID" &&
        error.message === "BILLING_ENVIRONMENT_INVALID",
    );
  }
});

test("expectedLemonSqueezyTestMode maps the canonical environment", () => {
  assert.equal(expectedLemonSqueezyTestMode("test"), true);
  assert.equal(expectedLemonSqueezyTestMode("live"), false);
});

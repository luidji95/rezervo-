import assert from "node:assert/strict";
import test from "node:test";

import {
  LemonSqueezyProviderConfigError,
  resolveLemonSqueezyProviderConfig,
} from "./lemonSqueezyProviderConfigCore.ts";

const bothCredentialSlots = {
  BILLING_PROVIDER: "lemonsqueezy",
  LEMONSQUEEZY_API_KEY: "test-api-key",
  LEMONSQUEEZY_STORE_ID: "100",
  LEMONSQUEEZY_LIVE_API_KEY: "live-api-key",
  LEMONSQUEEZY_LIVE_STORE_ID: "200",
};

function rejectsConfig(action: () => unknown) {
  assert.throws(
    action,
    (error: unknown) => error instanceof LemonSqueezyProviderConfigError,
  );
}

test("test and live resolve only their dedicated credential slots", () => {
  assert.deepEqual(
    resolveLemonSqueezyProviderConfig(
      { ...bothCredentialSlots, BILLING_ENVIRONMENT: "test" },
      "test",
    ),
    {
      provider: "lemonsqueezy",
      environment: "test",
      apiKey: "test-api-key",
      storeId: "100",
    },
  );
  assert.deepEqual(
    resolveLemonSqueezyProviderConfig(
      { ...bothCredentialSlots, BILLING_ENVIRONMENT: "live" },
      "live",
    ),
    {
      provider: "lemonsqueezy",
      environment: "live",
      apiKey: "live-api-key",
      storeId: "200",
    },
  );
});

test("missing environment-specific credentials fail without cross fallback", () => {
  for (const patch of [
    { LEMONSQUEEZY_LIVE_API_KEY: undefined },
    { LEMONSQUEEZY_LIVE_STORE_ID: undefined },
  ]) {
    rejectsConfig(() =>
      resolveLemonSqueezyProviderConfig(
        {
          ...bothCredentialSlots,
          BILLING_ENVIRONMENT: "live",
          ...patch,
        },
        "live",
      ),
    );
  }
  rejectsConfig(() =>
    resolveLemonSqueezyProviderConfig(
      {
        BILLING_PROVIDER: "lemonsqueezy",
        BILLING_ENVIRONMENT: "test",
        LEMONSQUEEZY_LIVE_API_KEY: "live-api-key",
        LEMONSQUEEZY_LIVE_STORE_ID: "200",
      },
      "test",
    ),
  );
  rejectsConfig(() =>
    resolveLemonSqueezyProviderConfig(
      {
        BILLING_PROVIDER: "lemonsqueezy",
        BILLING_ENVIRONMENT: "live",
        LEMONSQUEEZY_API_KEY: "test-api-key",
        LEMONSQUEEZY_STORE_ID: "100",
      },
      "live",
    ),
  );
});

test("deployment attestation is exact and ignores runtime aliases", () => {
  rejectsConfig(() =>
    resolveLemonSqueezyProviderConfig(
      { ...bothCredentialSlots, BILLING_ENVIRONMENT: "test" },
      "live",
    ),
  );
  rejectsConfig(() =>
    resolveLemonSqueezyProviderConfig(
      { ...bothCredentialSlots, BILLING_ENVIRONMENT: "live" },
      "test",
    ),
  );
  rejectsConfig(() =>
    resolveLemonSqueezyProviderConfig(
      {
        ...bothCredentialSlots,
        BILLING_ENVIRONMENT: undefined,
        NODE_ENV: "test",
        VERCEL_ENV: "preview",
      },
      "test",
    ),
  );
});

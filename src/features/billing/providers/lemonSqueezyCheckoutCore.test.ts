import assert from "node:assert/strict";
import test from "node:test";

import { LemonSqueezyCheckoutCore } from "./lemonSqueezyCheckoutCore.ts";
import { BillingCheckoutError } from "./billingCheckoutErrors.ts";
import type { CreateCheckoutSessionInput } from "./billingProvider.ts";

const input: CreateCheckoutSessionInput = {
  checkoutSessionId: "10000000-0000-4000-8000-000000000004",
  salonId: "10000000-0000-4000-8000-000000000001",
  actorProfileId: "10000000-0000-4000-8000-000000000002",
  planCode: "starter",
  billingInterval: "monthly",
  idempotencyKey: "10000000-0000-4000-8000-000000000003",
  successUrl: "https://rezervo.example/settings?tab=billing&checkout=return",
  cancelUrl: "https://rezervo.example/settings?tab=billing&checkout=cancelled",
  customerEmail: "owner@example.invalid",
  environment: "test",
  providerStoreId: "123",
  providerVariantId: "456",
  expiresAt: "2026-07-27T13:30:00.000Z",
};

test("creates a test checkout from the server-owned variant without a custom price", async () => {
  let capturedAuthorization = "";
  let capturedBody: unknown;
  const provider = new LemonSqueezyCheckoutCore(
    "test-secret-not-real",
    async (_url, init) => {
      capturedAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({
        data: {
          type: "checkouts",
          id: "checkout-fixture",
          attributes: {
            url: "https://sandbox.example.invalid/checkout/fixture",
            expires_at: input.expiresAt,
            test_mode: true,
          },
        },
      });
    },
  );

  const result = await provider.createCheckoutSession(input);
  assert.equal(result.providerSessionId, "checkout-fixture");
  assert.equal(capturedAuthorization, "Bearer test-secret-not-real");
  const serialized = JSON.stringify(capturedBody);
  assert.equal(serialized.includes("custom_price"), false);
  assert.equal(serialized.includes(input.cancelUrl), false);
  assert.equal(serialized.includes('"test_mode":true'), true);
  assert.equal(serialized.includes('"id":"456"'), true);
  const body = capturedBody as {
    data: { attributes: { checkout_data: { custom: Record<string, string> } } };
  };
  assert.deepEqual(body.data.attributes.checkout_data.custom, {
    checkout_session_id: input.checkoutSessionId,
    salon_id: input.salonId,
    plan_code: input.planCode,
    idempotency_key: input.idempotencyKey,
  });
});

test("creates live checkout mode only from the trusted input environment", async () => {
  let capturedBody: unknown;
  const provider = new LemonSqueezyCheckoutCore("live-secret-not-real", async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return Response.json({
      data: {
        type: "checkouts",
        id: "live-checkout-fixture",
        attributes: {
          url: "https://live.example.invalid/checkout/fixture",
          expires_at: input.expiresAt,
          test_mode: false,
        },
      },
    });
  });
  const result = await provider.createCheckoutSession({ ...input, environment: "live" });
  assert.equal(result.environment, "live");
  assert.equal(JSON.stringify(capturedBody).includes('"test_mode":false'), true);
});

test("provider mode mismatch fails closed for test and live", async () => {
  for (const [environment, responseTestMode] of [
    ["test", false],
    ["live", true],
  ] as const) {
    const provider = new LemonSqueezyCheckoutCore("secret", async () =>
      Response.json({
        data: {
          type: "checkouts",
          id: "mismatch",
          attributes: {
            url: "https://example.invalid/checkout/mismatch",
            test_mode: responseTestMode,
          },
        },
      }),
    );
    await assert.rejects(
      () => provider.createCheckoutSession({ ...input, environment }),
      (error: unknown) =>
        error instanceof BillingCheckoutError &&
        error.code === "BILLING_RECONCILIATION_REQUIRED",
    );
  }
});

test("every ambiguous 2xx result requires reconciliation in test and live", async () => {
  const cases = [
    ["malformed JSON", () => new Response("{", { status: 200 })],
    ["missing ID", (testMode: boolean) => Response.json({ data: { type: "checkouts", attributes: { url: "https://example.invalid/checkout", test_mode: testMode } } })],
    ["blank ID", (testMode: boolean) => Response.json({ data: { type: "checkouts", id: "   ", attributes: { url: "https://example.invalid/checkout", test_mode: testMode } } })],
    ["missing URL", (testMode: boolean) => Response.json({ data: { type: "checkouts", id: "checkout-id", attributes: { test_mode: testMode } } })],
    ["non-HTTPS URL", (testMode: boolean) => Response.json({ data: { type: "checkouts", id: "checkout-id", attributes: { url: "http://example.invalid/checkout", test_mode: testMode } } })],
    ["wrong response type", (testMode: boolean) => Response.json({ data: { type: "subscriptions", id: "checkout-id", attributes: { url: "https://example.invalid/checkout", test_mode: testMode } } })],
  ] as const;

  for (const environment of ["test", "live"] as const) {
    const expectedTestMode = environment === "test";
    for (const [name, responseFactory] of cases) {
      const provider = new LemonSqueezyCheckoutCore("secret", async () =>
        responseFactory(expectedTestMode),
      );
      await assert.rejects(
        () => provider.createCheckoutSession({ ...input, environment }),
        (error: unknown) =>
          error instanceof BillingCheckoutError &&
          error.code === "BILLING_RECONCILIATION_REQUIRED",
        `${environment}: ${name}`,
      );
    }
  }
});

test("network uncertainty requires reconciliation while definite 4xx stays rejected", async () => {
  for (const environment of ["test", "live"] as const) {
    const networkFailure = new LemonSqueezyCheckoutCore("secret", async () => {
      throw new TypeError("network details must stay private");
    });
    await assert.rejects(
      () => networkFailure.createCheckoutSession({ ...input, environment }),
      (error: unknown) =>
        error instanceof BillingCheckoutError &&
        error.code === "BILLING_RECONCILIATION_REQUIRED" &&
        !error.message.includes("network details"),
    );

    const rejected = new LemonSqueezyCheckoutCore("secret", async () =>
      Response.json({ errors: [{ detail: "private" }] }, { status: 422 }),
    );
    await assert.rejects(
      () => rejected.createCheckoutSession({ ...input, environment }),
      (error: unknown) =>
        error instanceof BillingCheckoutError &&
        error.code === "BILLING_PROVIDER_REJECTED",
    );
  }
});

test("nullable expiry falls back while malformed provider expiry requires reconciliation", async () => {
  for (const providerExpiresAt of [undefined, null]) {
    const provider = new LemonSqueezyCheckoutCore("secret", async () =>
      Response.json({
        data: {
          type: "checkouts",
          id: "checkout-id",
          attributes: {
            url: "https://example.invalid/checkout",
            expires_at: providerExpiresAt,
            test_mode: true,
          },
        },
      }),
    );
    const result = await provider.createCheckoutSession(input);
    assert.equal(result.expiresAt, input.expiresAt);
  }

  for (const providerExpiresAt of ["not-a-date", 12345]) {
    const provider = new LemonSqueezyCheckoutCore("secret", async () =>
      Response.json({
        data: {
          type: "checkouts",
          id: "checkout-id",
          attributes: {
            url: "https://example.invalid/checkout",
            expires_at: providerExpiresAt,
            test_mode: true,
          },
        },
      }),
    );
    await assert.rejects(
      () => provider.createCheckoutSession(input),
      (error: unknown) =>
        error instanceof BillingCheckoutError &&
        error.code === "BILLING_RECONCILIATION_REQUIRED",
    );
  }
});

test("sanitizes provider rejection and rejects malformed mappings", async () => {
  const rejected = new LemonSqueezyCheckoutCore("secret", async () =>
    Response.json({ errors: [{ detail: "private provider detail" }] }, { status: 422 }),
  );
  await assert.rejects(
    () => rejected.createCheckoutSession(input),
    (error: unknown) =>
      error instanceof BillingCheckoutError &&
      error.code === "BILLING_PROVIDER_REJECTED" &&
      !error.message.includes("private"),
  );

  await assert.rejects(
    () => rejected.createCheckoutSession({ ...input, providerVariantId: "browser-value" }),
    (error: unknown) =>
      error instanceof BillingCheckoutError &&
      error.code === "BILLING_PRICE_MAPPING_MISSING",
  );
});

test("a provider timeout becomes reconciliation required", async () => {
  const provider = new LemonSqueezyCheckoutCore(
    "secret",
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    5,
  );
  await assert.rejects(
    () => provider.createCheckoutSession(input),
    (error: unknown) =>
      error instanceof BillingCheckoutError &&
      error.code === "BILLING_RECONCILIATION_REQUIRED",
  );
});

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

test("sanitizes provider rejection and rejects non-test or malformed mappings", async () => {
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

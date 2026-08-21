import assert from "node:assert/strict";
import test from "node:test";

import { BillingCheckoutError } from "./billingCheckoutErrors.ts";
import { LemonSqueezyCheckoutCore } from "./lemonSqueezyCheckoutCore.ts";
import type { CreateCheckoutSessionInput } from "./billingProvider.ts";
import { parseLemonSqueezyCheckoutId, parseLemonSqueezyNumericObjectId } from "./lemonSqueezyResourceIds.ts";

const providerCheckoutId = "4a000000-0000-0000-0000-000000000001";
const now = new Date("2026-07-27T13:00:00.000Z");
const providerExpiresAt = "2026-07-27T13:30:00.000Z";
const urlExpires = String(Date.parse(providerExpiresAt) / 1000);
const validUrl = `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=opaque-signature`;

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
  expiresAt: providerExpiresAt,
};

type ResponseOverrides = {
  type?: unknown;
  id?: unknown;
  attributes?: Record<string, unknown>;
  custom?: Record<string, unknown> | null;
};

function payload(overrides: ResponseOverrides = {}) {
  const custom = {
    checkout_session_id: input.checkoutSessionId,
    salon_id: input.salonId,
    plan_code: input.planCode,
    idempotency_key: input.idempotencyKey,
    ...(overrides.custom ?? {}),
  };
  return {
    data: {
      type: overrides.type ?? "checkouts",
      id: overrides.id ?? providerCheckoutId,
      attributes: {
        store_id: 123,
        variant_id: 456,
        checkout_data: { custom: overrides.custom === null ? null : custom },
        test_mode: true,
        url: validUrl,
        expires_at: providerExpiresAt,
        created_at: "2026-07-27T13:00:01.000Z",
        updated_at: "2026-07-27T13:00:01.000Z",
        ...overrides.attributes,
      },
    },
  };
}

function jsonApiResponse(overrides: ResponseOverrides = {}, status = 201) {
  return new Response(JSON.stringify(payload(overrides)), {
    status,
    headers: { "Content-Type": "application/vnd.api+json; charset=utf-8" },
  });
}

function provider(fetchImpl: typeof fetch, timeoutMs = 10_000) {
  return new LemonSqueezyCheckoutCore("secret-not-real", fetchImpl, timeoutMs, () => now);
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) =>
    error instanceof BillingCheckoutError && error.code === code && error.message === code);
}

test("valid JSON:API create response uses trusted identity and redirect:error", async () => {
  let capturedInit: RequestInit | undefined;
  const checkout = provider(async (_url, init) => {
    capturedInit = init;
    return jsonApiResponse();
  });
  const result = await checkout.createCheckoutSession(input);
  assert.deepEqual(result, {
    provider: "lemonsqueezy",
    providerSessionId: providerCheckoutId,
    checkoutUrl: validUrl,
    expiresAt: providerExpiresAt,
    environment: "test",
  });
  assert.equal(capturedInit?.redirect, "error");
  const body = JSON.parse(String(capturedInit?.body));
  assert.deepEqual(body.data.attributes.checkout_data.custom, {
    checkout_session_id: input.checkoutSessionId,
    salon_id: input.salonId,
    plan_code: input.planCode,
    idempotency_key: input.idempotencyKey,
  });
  assert.equal(JSON.stringify(body).includes("custom_price"), false);
  assert.deepEqual(body.data.relationships.store.data, { type: "stores", id: "123" });
  assert.deepEqual(body.data.relationships.variant.data, { type: "variants", id: "456" });
});

test("live create requires trusted live mode in the returned Checkout object", async () => {
  const checkout = provider(async () => jsonApiResponse({ attributes: { test_mode: false } }));
  assert.equal((await checkout.createCheckoutSession({ ...input, environment: "live" })).environment, "live");
  await expectCode(
    () => provider(async () => jsonApiResponse()).createCheckoutSession({ ...input, environment: "live" }),
    "BILLING_RECONCILIATION_REQUIRED",
  );
});

test("strict create URL contract rejects unsafe host, path and signed-query shapes", async () => {
  const otherId = "4a000000-0000-0000-0000-000000000002";
  const invalidUrls = [
    `http://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x`,
    `https://evil.example/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x`,
    `https://rezervoo.lemonsqueezy.com.evil.example/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x`,
    `https://user:pass@rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x`,
    `https://rezervoo.lemonsqueezy.com:444/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x#fragment`,
    `https://rezervoo.lemonsqueezy.com/checkout/buy/${providerCheckoutId}?expires=${urlExpires}&signature=x`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${otherId}?expires=${urlExpires}&signature=x`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?signature=x`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=&signature=x`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&expires=${urlExpires}&signature=x`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x&signature=y`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=${urlExpires}&signature=x&extra=1`,
    `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1&signature=x`,
    "not-a-url",
  ];
  for (const url of invalidUrls) {
    await expectCode(
      () => provider(async () => jsonApiResponse({ attributes: { url } })).createCheckoutSession(input),
      "BILLING_RECONCILIATION_REQUIRED",
    );
  }
});

test("identity, mapping, mode, resource and expiry mismatches fail closed", async () => {
  const invalid: ResponseOverrides[] = [
    { id: "4a000000-0000-0000-0000-000000000002" },
    { id: providerCheckoutId.toUpperCase() },
    { id: "123" },
    { type: "subscriptions" },
    { attributes: { store_id: 999 } },
    { attributes: { variant_id: 999 } },
    { attributes: { test_mode: false } },
    { custom: { checkout_session_id: "10000000-0000-4000-8000-000000000099" } },
    { custom: { idempotency_key: "10000000-0000-4000-8000-000000000099" } },
    { custom: { salon_id: "10000000-0000-4000-8000-000000000099" } },
    { custom: { plan_code: "pro" } },
    { custom: null },
    { attributes: { expires_at: null } },
    { attributes: { expires_at: "not-a-date" } },
    { attributes: { expires_at: "2026-07-27T12:59:59.000Z" } },
  ];
  for (const overrides of invalid) {
    await expectCode(
      () => provider(async () => jsonApiResponse(overrides)).createCheckoutSession(input),
      "BILLING_RECONCILIATION_REQUIRED",
    );
  }
});

test("create requires exact JSON:API media type and well-formed JSON", async () => {
  for (const contentType of [null, "application/json", "text/html", "application/vnd.api+json-malicious"]) {
    const checkout = provider(async () => new Response(JSON.stringify(payload()), {
      status: 201,
      ...(contentType === null ? {} : { headers: { "Content-Type": contentType } }),
    }));
    await expectCode(() => checkout.createCheckoutSession(input), "BILLING_RECONCILIATION_REQUIRED");
  }
  await expectCode(
    () => provider(async () => new Response("{", { status: 201, headers: { "Content-Type": "application/vnd.api+json" } })).createCheckoutSession(input),
    "BILLING_RECONCILIATION_REQUIRED",
  );
});

test("only enumerated definitive HTTP rejections use BILLING_PROVIDER_REJECTED", async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    await expectCode(
      () => provider(async () => new Response("", { status })).createCheckoutSession(input),
      "BILLING_PROVIDER_REJECTED",
    );
  }
  for (const status of [408, 409, 418, 425, 429, 500, 502, 503, 504]) {
    await expectCode(
      () => provider(async () => new Response("", { status })).createCheckoutSession(input),
      "BILLING_RECONCILIATION_REQUIRED",
    );
  }
});

test("network, redirect-like fetch failure and timeout remain sanitized ambiguity", async () => {
  for (const error of [new TypeError("private network detail"), new TypeError("private redirect detail")]) {
    await expectCode(
      () => provider(async () => { throw error; }).createCheckoutSession(input),
      "BILLING_RECONCILIATION_REQUIRED",
    );
  }
  const timeout = provider(
    (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("private", "AbortError")));
    }),
    5,
  );
  await expectCode(() => timeout.createCheckoutSession(input), "BILLING_RECONCILIATION_REQUIRED");
});

test("Checkout UUID and numeric object IDs remain separate contracts", () => {
  assert.equal(parseLemonSqueezyCheckoutId(providerCheckoutId), providerCheckoutId);
  for (const value of [providerCheckoutId.toUpperCase(), "123", providerCheckoutId.replaceAll("-", ""), ` ${providerCheckoutId}`, null, ""])
    assert.throws(() => parseLemonSqueezyCheckoutId(value));
  assert.equal(parseLemonSqueezyNumericObjectId("123"), "123");
  assert.equal(parseLemonSqueezyNumericObjectId(123), "123");
  for (const value of [providerCheckoutId, "0", "-1", "1.5", "", "object"])
    assert.throws(() => parseLemonSqueezyNumericObjectId(value));
});

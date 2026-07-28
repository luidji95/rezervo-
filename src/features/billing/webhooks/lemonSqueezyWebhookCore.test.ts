import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { resolveBillingWebhookConfig } from "./billingWebhookConfigCore.ts";
import { BillingWebhookError } from "./billingWebhookErrors.ts";
import {
  createLemonSqueezySemanticFingerprint,
  ingestLemonSqueezyWebhook,
  verifyLemonSqueezyWebhookSignature,
  type BillingWebhookEventInput,
  type BillingWebhookEventRepository,
} from "./lemonSqueezyWebhookCore.ts";

const secret = "unit-test-webhook-secret";

function payload(
  eventName = "subscription_created",
  testMode = true,
  webhookId = "00000000-0000-4000-8000-00000000000a",
) {
  return JSON.stringify({
    meta: { webhook_id: webhookId, event_name: eventName, custom_data: { untrusted: "ignored" } },
    data: {
      type: "subscriptions",
      id: "test-subscription-object",
      attributes: { test_mode: testMode, customer_email: "not-persisted@example.test" },
    },
  });
}

function sign(rawBody: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

class MemoryRepository implements BillingWebhookEventRepository {
  readonly rows: BillingWebhookEventInput[] = [];
  private readonly rawHashes = new Set<string>();
  private readonly semanticFingerprints = new Set<string>();

  async insertEvent(input: BillingWebhookEventInput) {
    if (
      this.rawHashes.has(input.payloadHash) ||
      this.semanticFingerprints.has(input.semanticFingerprint)
    ) {
      return { outcome: "duplicate" as const };
    }
    this.rawHashes.add(input.payloadHash);
    this.semanticFingerprints.add(input.semanticFingerprint);
    this.rows.push(input);
    await Promise.resolve();
    return { outcome: "inserted" as const, id: `event-${this.rows.length}` };
  }
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    return error instanceof BillingWebhookError && error.code === code;
  });
}

test("valid signature passes and body changes invalidate it", () => {
  const rawBody = payload();
  const signature = sign(rawBody);
  assert.equal(
    verifyLemonSqueezyWebhookSignature({ rawBody, signature, webhookSecret: secret }),
    true,
  );
  assert.equal(
    verifyLemonSqueezyWebhookSignature({
      rawBody: `${rawBody} `,
      signature,
      webhookSecret: secret,
    }),
    false,
  );
});

test("missing, malformed and wrong-length signatures fail without throwing", async () => {
  const rawBody = payload();
  const repository = new MemoryRepository();
  await expectCode(
    () => ingestLemonSqueezyWebhook({ rawBody, signature: null, webhookSecret: secret, repository }),
    "BILLING_WEBHOOK_SIGNATURE_MISSING",
  );
  for (const signature of ["not-hex", "abc", "00", sign(rawBody).slice(2)]) {
    await expectCode(
      () => ingestLemonSqueezyWebhook({ rawBody, signature, webhookSecret: secret, repository }),
      "BILLING_WEBHOOK_SIGNATURE_INVALID",
    );
  }
  assert.equal(repository.rows.length, 0);
});

test("JSON parsing happens only after signature verification", async () => {
  const repository = new MemoryRepository();
  await expectCode(
    () => ingestLemonSqueezyWebhook({ rawBody: "{", signature: "00", webhookSecret: secret, repository }),
    "BILLING_WEBHOOK_SIGNATURE_INVALID",
  );
  await expectCode(
    () => ingestLemonSqueezyWebhook({ rawBody: "{", signature: sign("{"), webhookSecret: secret, repository }),
    "BILLING_WEBHOOK_PAYLOAD_INVALID",
  );
});

test("webhook config fails closed when disabled, incomplete or non-test", () => {
  assert.throws(
    () => resolveBillingWebhookConfig({}),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_DISABLED",
  );
  assert.throws(
    () => resolveBillingWebhookConfig({ BILLING_WEBHOOKS_ENABLED: "true", BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "test" }),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
  assert.throws(
    () => resolveBillingWebhookConfig({ BILLING_WEBHOOKS_ENABLED: "true", BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "live", LEMONSQUEEZY_WEBHOOK_SECRET: secret }),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
});

test("test events are received, live and invalid payloads are rejected", async () => {
  const repository = new MemoryRepository();
  const rawBody = payload();
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository }),
    { status: "received" },
  );
  assert.equal(repository.rows[0]?.processingStatus, "received");
  assert.equal(repository.rows[0]?.processedAt, null);

  const liveBody = payload("subscription_created", false);
  await expectCode(
    () => ingestLemonSqueezyWebhook({ rawBody: liveBody, signature: sign(liveBody), webhookSecret: secret, repository }),
    "BILLING_WEBHOOK_ENVIRONMENT_MISMATCH",
  );
  const invalidBody = JSON.stringify({ meta: {}, data: {} });
  await expectCode(
    () => ingestLemonSqueezyWebhook({ rawBody: invalidBody, signature: sign(invalidBody), webhookSecret: secret, repository }),
    "BILLING_WEBHOOK_PAYLOAD_INVALID",
  );
  assert.equal(repository.rows.length, 1);
});

test("unsupported signed event is stored as ignored", async () => {
  const repository = new MemoryRepository();
  const rawBody = payload("order_created");
  const result = await ingestLemonSqueezyWebhook({
    rawBody,
    signature: sign(rawBody),
    webhookSecret: secret,
    repository,
    now: () => new Date("2026-07-28T10:00:00.000Z"),
  });
  assert.deepEqual(result, { status: "ignored" });
  assert.equal(repository.rows[0]?.processingStatus, "ignored");
  assert.equal(repository.rows[0]?.processedAt, "2026-07-28T10:00:00.000Z");
});

test("sequential and parallel duplicate deliveries create one row", async () => {
  const repository = new MemoryRepository();
  const rawBody = payload("subscription_updated");
  const input = { rawBody, signature: sign(rawBody), webhookSecret: secret, repository };
  const first = await ingestLemonSqueezyWebhook(input);
  const second = await ingestLemonSqueezyWebhook(input);
  assert.deepEqual(first, { status: "received" });
  assert.deepEqual(second, { status: "duplicate" });

  const parallelBody = payload("subscription_payment_success");
  const parallelInput = {
    rawBody: parallelBody,
    signature: sign(parallelBody),
    webhookSecret: secret,
    repository,
  };
  const results = await Promise.all([
    ingestLemonSqueezyWebhook(parallelInput),
    ingestLemonSqueezyWebhook(parallelInput),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["duplicate", "received"]);
  assert.equal(repository.rows.length, 2);
});

test("original and resend webhook IDs produce one semantic event", async () => {
  const repository = new MemoryRepository();
  const original = payload(
    "subscription_created",
    true,
    "00000000-0000-4000-8000-00000000000a",
  );
  const resend = payload(
    "subscription_created",
    true,
    "00000000-0000-4000-8000-00000000000b",
  );
  const originalFingerprint = createLemonSqueezySemanticFingerprint(
    JSON.parse(original),
  );
  const resendFingerprint = createLemonSqueezySemanticFingerprint(
    JSON.parse(resend),
  );
  assert.equal(originalFingerprint, resendFingerprint);
  assert.notEqual(sign(original), sign(resend));
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({
      rawBody: original,
      signature: sign(original),
      webhookSecret: secret,
      repository,
    }),
    { status: "received" },
  );
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({
      rawBody: resend,
      signature: sign(resend),
      webhookSecret: secret,
      repository,
    }),
    { status: "duplicate" },
  );
  assert.equal(repository.rows.length, 1);
});

test("whitespace and object key order do not affect semantic fingerprint", () => {
  const ordered = {
    meta: {
      webhook_id: "delivery-a",
      event_name: "subscription_updated",
      custom_data: { salon_id: "salon-a", plan_code: "pro" },
    },
    data: {
      type: "subscriptions",
      id: "2383060",
      attributes: {
        test_mode: true,
        status: "active",
        updated_at: "2026-07-28T12:00:00Z",
      },
      relationships: { store: { data: { type: "stores", id: "1" } } },
    },
  };
  const reordered = {
    data: {
      relationships: { store: { data: { id: "1", type: "stores" } } },
      attributes: {
        updated_at: "2026-07-28T12:00:00Z",
        status: "active",
        test_mode: true,
      },
      id: "2383060",
      type: "subscriptions",
    },
    meta: {
      custom_data: { plan_code: "pro", salon_id: "salon-a" },
      event_name: "subscription_updated",
      webhook_id: "delivery-b",
    },
  };
  const compact = JSON.stringify(ordered);
  const spaced = JSON.stringify(reordered, null, 2);
  assert.equal(
    createLemonSqueezySemanticFingerprint(JSON.parse(compact)),
    createLemonSqueezySemanticFingerprint(JSON.parse(spaced)),
  );
});

test("business changes create distinct semantic fingerprints", () => {
  const base = {
    meta: {
      event_name: "subscription_updated",
      webhook_id: "delivery-a",
      custom_data: { salon_id: "salon-a", plan_code: "pro" },
    },
    data: {
      type: "subscriptions",
      id: "2383060",
      attributes: {
        test_mode: true,
        status: "active",
        updated_at: "2026-07-28T12:00:00Z",
        invoice_ids: ["invoice-a", "invoice-b"],
      },
    },
  };
  const fingerprint = createLemonSqueezySemanticFingerprint(base);
  const changed = [
    { ...base, meta: { ...base.meta, event_name: "subscription_cancelled" } },
    { ...base, meta: { ...base.meta, custom_data: { ...base.meta.custom_data, salon_id: "salon-b" } } },
    { ...base, data: { ...base.data, id: "2383061" } },
    { ...base, data: { ...base.data, attributes: { ...base.data.attributes, status: "cancelled" } } },
    { ...base, data: { ...base.data, attributes: { ...base.data.attributes, updated_at: "2026-07-28T12:01:00Z" } } },
    { ...base, data: { ...base.data, attributes: { ...base.data.attributes, invoice_ids: ["invoice-b", "invoice-a"] } } },
  ];
  for (const candidate of changed) {
    assert.notEqual(createLemonSqueezySemanticFingerprint(candidate), fingerprint);
  }
});

test("semantic fingerprinting does not mutate parsed payload", () => {
  const parsed = JSON.parse(payload());
  const before = structuredClone(parsed);
  createLemonSqueezySemanticFingerprint(parsed);
  assert.deepEqual(parsed, before);
  assert.equal(parsed.meta.webhook_id, before.meta.webhook_id);
});

test("parallel semantic resend and unsupported resend create one row each", async () => {
  const repository = new MemoryRepository();
  const original = payload("subscription_updated", true, "delivery-a");
  const resend = payload("subscription_updated", true, "delivery-b");
  const results = await Promise.all([
    ingestLemonSqueezyWebhook({ rawBody: original, signature: sign(original), webhookSecret: secret, repository }),
    ingestLemonSqueezyWebhook({ rawBody: resend, signature: sign(resend), webhookSecret: secret, repository }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["duplicate", "received"]);

  const ignoredOriginal = payload("order_created", true, "ignored-a");
  const ignoredResend = payload("order_created", true, "ignored-b");
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({ rawBody: ignoredOriginal, signature: sign(ignoredOriginal), webhookSecret: secret, repository }),
    { status: "ignored" },
  );
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({ rawBody: ignoredResend, signature: sign(ignoredResend), webhookSecret: secret, repository }),
    { status: "duplicate" },
  );
  assert.equal(repository.rows.length, 2);
});

test("signature remains bound to raw body rather than canonical JSON", async () => {
  const repository = new MemoryRepository();
  const original = payload();
  const reformatted = JSON.stringify(JSON.parse(original), null, 2);
  assert.equal(
    createLemonSqueezySemanticFingerprint(JSON.parse(original)),
    createLemonSqueezySemanticFingerprint(JSON.parse(reformatted)),
  );
  await expectCode(
    () => ingestLemonSqueezyWebhook({
      rawBody: reformatted,
      signature: sign(original),
      webhookSecret: secret,
      repository,
    }),
    "BILLING_WEBHOOK_SIGNATURE_INVALID",
  );
  assert.equal(repository.rows.length, 0);
});

test("ingestion does not mutate business state or checkout sessions", async () => {
  const repository = new MemoryRepository();
  const businessState = {
    plans: "plans-fingerprint",
    subscriptions: "subscriptions-fingerprint",
    entitlements: "entitlements-fingerprint",
    checkoutSessions: "checkout-sessions-fingerprint",
  };
  const before = structuredClone(businessState);
  const rawBody = payload("subscription_cancelled");
  await ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository });
  assert.deepEqual(businessState, before);
});

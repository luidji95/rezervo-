import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { resolveBillingWebhookConfig } from "./billingWebhookConfigCore.ts";
import { BillingWebhookError } from "./billingWebhookErrors.ts";
import {
  createLemonSqueezySemanticFingerprint,
  ingestLemonSqueezyWebhook as ingestLemonSqueezyWebhookCore,
  verifyLemonSqueezyWebhookSignature,
  type BillingWebhookEventInput,
  type BillingWebhookInvoiceEvidenceInput,
  type BillingWebhookEventRepository,
} from "./lemonSqueezyWebhookCore.ts";
import type { BillingEnvironment } from "../config/billingEnvironment.ts";

const secret = "unit-test-webhook-secret";

function ingestLemonSqueezyWebhook(
  input: Omit<
    Parameters<typeof ingestLemonSqueezyWebhookCore>[0],
    "environment"
  > & { environment?: BillingEnvironment },
) {
  return ingestLemonSqueezyWebhookCore({ environment: "test", ...input });
}

function payload(
  eventName = "subscription_created",
  testMode = true,
  webhookId = "00000000-0000-4000-8000-00000000000a",
  customData: Record<string, unknown> = {
    checkout_session_id: "10000000-0000-4000-8000-000000000001",
    salon_id: "10000000-0000-4000-8000-000000000002",
    plan_code: "pro",
    idempotency_key: "10000000-0000-4000-8000-000000000003",
  },
) {
  return JSON.stringify({
    meta: { webhook_id: webhookId, event_name: eventName, custom_data: customData },
    data: {
      type: "subscriptions",
      id: "2383060",
      attributes: {
        test_mode: testMode,
        store_id: 440512,
        order_id: 41001,
        customer_id: "51001",
        product_id: 61001,
        variant_id: "71001",
        status: "active",
        created_at: "2026-07-28T10:00:00.000Z",
        updated_at: "2026-07-28T10:01:00.000Z",
        renews_at: "2026-08-28T10:00:00.000Z",
        ends_at: null,
        cancelled: false,
        trial_ends_at: null,
        pause: null,
        customer_email: "not-persisted@example.test",
        user_name: "Not Persisted",
        billing_address: { line_1: "Not persisted" },
        urls: {
          customer_portal: "https://provider.example.invalid/private/signed-token",
          update_payment_method: "https://provider.example.invalid/private/payment-token",
        },
      },
    },
  });
}

function paymentPayload(
  eventName:
    | "subscription_payment_success"
    | "subscription_payment_failed"
    | "subscription_payment_recovered" = "subscription_payment_success",
  webhookId = "00000000-0000-4000-8000-00000000000c",
  attributeOverrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    meta: {
      webhook_id: webhookId,
      event_name: eventName,
      custom_data: {
        checkout_session_id: "10000000-0000-4000-8000-000000000001",
      },
    },
    data: {
      type: "subscription-invoices",
      id: "81001",
      attributes: {
        test_mode: true,
        store_id: 440512,
        subscription_id: 2383060,
        customer_id: 99110,
        billing_reason: "renewal",
        status: "paid",
        created_at: "2026-07-28T10:59:00.000Z",
        updated_at: "2026-07-28T11:00:00.000Z",
        customer_email: "not-persisted@example.test",
        billing_address: { line_1: "Not persisted" },
        urls: { invoice_url: "https://provider.example.invalid/private/invoice" },
        ...attributeOverrides,
      },
    },
  });
}

function sign(rawBody: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

class MemoryRepository implements BillingWebhookEventRepository {
  readonly rows: BillingWebhookEventInput[] = [];
  readonly invoiceRows: BillingWebhookInvoiceEvidenceInput[] = [];
  processorCalls = 0;
  private readonly rawHashes = new Set<string>();
  private readonly semanticFingerprints = new Set<string>();
  private storedStatus = "received";

  async insertEvent(input: BillingWebhookEventInput) {
    if (
      this.rawHashes.has(input.payloadHash) ||
      this.semanticFingerprints.has(input.semanticFingerprint)
    ) {
      return { outcome: "duplicate" as const, id: "event-1", storedStatus: this.storedStatus };
    }
    this.rawHashes.add(input.payloadHash);
    this.semanticFingerprints.add(input.semanticFingerprint);
    this.rows.push(input);
    this.storedStatus = input.processingStatus;
    await Promise.resolve();
    return { outcome: "inserted" as const, id: `event-${this.rows.length}`, storedStatus: input.processingStatus };
  }

  async processSubscriptionCreated() {
    this.processorCalls += 1;
    this.storedStatus = "processed";
    await Promise.resolve();
    return { outcome: "processed" as const };
  }

  async processSubscriptionUpdated() {
    this.processorCalls += 1;
    if (this.storedStatus === "processed") {
      return { outcome: "already_processed" as const };
    }
    this.storedStatus = "processed";
    await Promise.resolve();
    return { outcome: "processed" as const };
  }

  async recordSubscriptionInvoiceEvidence(input: BillingWebhookInvoiceEvidenceInput) {
    if (this.rawHashes.has(input.payloadHash) || this.semanticFingerprints.has(input.semanticFingerprint)) {
      return { outcome: "invoice_evidence_already_recorded" as const, storedStatus: "processed" as const };
    }
    this.rawHashes.add(input.payloadHash);
    this.semanticFingerprints.add(input.semanticFingerprint);
    const existing = this.invoiceRows.find((row) =>
      row.provider === input.provider && row.environment === input.environment &&
      row.invoiceFacts.providerInvoiceId === input.invoiceFacts.providerInvoiceId);
    if (existing) {
      const same = JSON.stringify(existing.invoiceFacts) === JSON.stringify(input.invoiceFacts);
      return same
        ? { outcome: "invoice_evidence_already_recorded" as const, storedStatus: "processed" as const }
        : { outcome: "invoice_evidence_conflict" as const, storedStatus: "manual_review" as const };
    }
    this.invoiceRows.push(input);
    return { outcome: "invoice_evidence_recorded" as const, storedStatus: "processed" as const };
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

test("webhook configs are capability- and secret-isolated", () => {
  const runtimeAliasesWithoutBillingEnvironment = {
    BILLING_WEBHOOKS_ENABLED: "true",
    BILLING_PROVIDER: "lemonsqueezy",
    NODE_ENV: "test",
    VERCEL_ENV: "preview",
    LEMONSQUEEZY_WEBHOOK_SECRET: secret,
  };
  assert.throws(
    () => resolveBillingWebhookConfig({}, "test"),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_DISABLED",
  );
  assert.throws(
    () => resolveBillingWebhookConfig({ BILLING_WEBHOOKS_ENABLED: "true", BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "test" }, "test"),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
  assert.throws(
    () => resolveBillingWebhookConfig({ BILLING_WEBHOOKS_ENABLED: "true", BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "live", LEMONSQUEEZY_WEBHOOK_SECRET: secret }, "test"),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
  assert.throws(
    () => resolveBillingWebhookConfig(runtimeAliasesWithoutBillingEnvironment, "test"),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
  assert.deepEqual(
    resolveBillingWebhookConfig({
      BILLING_WEBHOOKS_ENABLED: "true",
      BILLING_PROVIDER: "lemonsqueezy",
      BILLING_ENVIRONMENT: "test",
      LEMONSQUEEZY_WEBHOOK_SECRET: secret,
    }, "test"),
    { provider: "lemonsqueezy", environment: "test", webhookSecret: secret },
  );
  assert.throws(
    () =>
      resolveBillingWebhookConfig(
        {
          BILLING_WEBHOOKS_ENABLED: "true",
          BILLING_PROVIDER: "lemonsqueezy",
          BILLING_ENVIRONMENT: "live",
          LEMONSQUEEZY_WEBHOOK_SECRET: secret,
        },
        "live",
      ),
    (error: unknown) =>
      error instanceof BillingWebhookError &&
      error.code === "BILLING_WEBHOOK_DISABLED",
  );
  assert.throws(
    () =>
      resolveBillingWebhookConfig(
        {
          BILLING_LIVE_WEBHOOKS_ENABLED: "true",
          BILLING_PROVIDER: "lemonsqueezy",
          BILLING_ENVIRONMENT: "live",
          LEMONSQUEEZY_WEBHOOK_SECRET: secret,
        },
        "live",
      ),
    (error: unknown) =>
      error instanceof BillingWebhookError &&
      error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
  assert.deepEqual(
    resolveBillingWebhookConfig(
      {
        BILLING_LIVE_WEBHOOKS_ENABLED: "true",
        BILLING_PROVIDER: "lemonsqueezy",
        BILLING_ENVIRONMENT: "live",
        LEMONSQUEEZY_LIVE_WEBHOOK_SECRET: "live-unit-test-secret",
      },
      "live",
    ),
    {
      provider: "lemonsqueezy",
      environment: "live",
      webhookSecret: "live-unit-test-secret",
    },
  );
});

test("deployment billing environment permits only its attested webhook capability", () => {
  const sharedCapabilities = {
    BILLING_WEBHOOKS_ENABLED: "true",
    BILLING_LIVE_WEBHOOKS_ENABLED: "true",
    BILLING_PROVIDER: "lemonsqueezy",
    LEMONSQUEEZY_WEBHOOK_SECRET: "test-unit-secret",
    LEMONSQUEEZY_LIVE_WEBHOOK_SECRET: "live-unit-secret",
  };

  const testDeployment = {
    ...sharedCapabilities,
    BILLING_ENVIRONMENT: "test",
  };
  assert.deepEqual(resolveBillingWebhookConfig(testDeployment, "test"), {
    provider: "lemonsqueezy",
    environment: "test",
    webhookSecret: "test-unit-secret",
  });
  assert.throws(
    () => resolveBillingWebhookConfig(testDeployment, "live"),
    (error: unknown) =>
      error instanceof BillingWebhookError &&
      error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );

  const liveDeployment = {
    ...sharedCapabilities,
    BILLING_ENVIRONMENT: "live",
  };
  assert.deepEqual(resolveBillingWebhookConfig(liveDeployment, "live"), {
    provider: "lemonsqueezy",
    environment: "live",
    webhookSecret: "live-unit-secret",
  });
  assert.throws(
    () => resolveBillingWebhookConfig(liveDeployment, "test"),
    (error: unknown) =>
      error instanceof BillingWebhookError &&
      error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
});

test("test route cannot be enabled by live capability or live secret", () => {
  assert.throws(
    () =>
      resolveBillingWebhookConfig(
        {
          BILLING_LIVE_WEBHOOKS_ENABLED: "true",
          BILLING_PROVIDER: "lemonsqueezy",
          BILLING_ENVIRONMENT: "test",
          LEMONSQUEEZY_LIVE_WEBHOOK_SECRET: "live-unit-secret",
        },
        "test",
      ),
    (error: unknown) =>
      error instanceof BillingWebhookError &&
      error.code === "BILLING_WEBHOOK_DISABLED",
  );

  assert.throws(
    () =>
      resolveBillingWebhookConfig(
        {
          BILLING_WEBHOOKS_ENABLED: "true",
          BILLING_PROVIDER: "lemonsqueezy",
          BILLING_ENVIRONMENT: "test",
          LEMONSQUEEZY_LIVE_WEBHOOK_SECRET: "live-unit-secret",
        },
        "test",
      ),
    (error: unknown) =>
      error instanceof BillingWebhookError &&
      error.code === "BILLING_WEBHOOK_NOT_CONFIGURED",
  );
});

test("trusted environment determines accepted provider mode and persisted environment", async () => {
  const testRepository = new MemoryRepository();
  const testBody = payload("subscription_created", true);
  await ingestLemonSqueezyWebhookCore({
    rawBody: testBody,
    signature: sign(testBody),
    webhookSecret: secret,
    environment: "test",
    repository: testRepository,
  });
  assert.equal(testRepository.rows[0]?.environment, "test");

  const liveRepository = new MemoryRepository();
  const liveBody = payload("subscription_created", false);
  await ingestLemonSqueezyWebhookCore({
    rawBody: liveBody,
    signature: sign(liveBody),
    webhookSecret: secret,
    environment: "live",
    repository: liveRepository,
  });
  assert.equal(liveRepository.rows[0]?.environment, "live");

  await expectCode(
    () =>
      ingestLemonSqueezyWebhookCore({
        rawBody: liveBody,
        signature: sign(liveBody),
        webhookSecret: secret,
        environment: "test",
        repository: new MemoryRepository(),
      }),
    "BILLING_WEBHOOK_ENVIRONMENT_MISMATCH",
  );
  await expectCode(
    () =>
      ingestLemonSqueezyWebhookCore({
        rawBody: testBody,
        signature: sign(testBody),
        webhookSecret: secret,
        environment: "live",
        repository: new MemoryRepository(),
      }),
    "BILLING_WEBHOOK_ENVIRONMENT_MISMATCH",
  );
});

test("test events are received, live and invalid payloads are rejected", async () => {
  const repository = new MemoryRepository();
  const rawBody = payload();
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository }),
    { status: "processed" },
  );
  assert.equal(repository.rows[0]?.processingStatus, "received");
  assert.equal(repository.rows[0]?.processedAt, null);
  assert.deepEqual(repository.rows[0]?.subscriptionFacts, {
    checkoutSessionId: "10000000-0000-4000-8000-000000000001",
    customSalonId: "10000000-0000-4000-8000-000000000002",
    customPlanCode: "pro",
    customIdempotencyKey: "10000000-0000-4000-8000-000000000003",
    providerSubscriptionId: "2383060",
    providerOrderId: "41001",
    providerCustomerId: "51001",
    providerProductId: "61001",
    providerVariantId: "71001",
    providerStatus: "active",
    providerCreatedAt: "2026-07-28T10:00:00.000Z",
    providerUpdatedAt: "2026-07-28T10:01:00.000Z",
    providerStoreId: "440512",
    providerRenewsAt: "2026-08-28T10:00:00.000Z",
    providerEndsAt: null,
    providerCancelled: false,
    providerTrialEndsAt: null,
    providerPauseMode: null,
    providerPauseResumesAt: null,
    testMode: true,
    correlationStatus: "ready",
    correlationErrorCode: null,
  });
  const persistedContract = JSON.stringify(repository.rows[0]);
  for (const forbidden of ["not-persisted@example.test", "Not Persisted", "signed-token", "payment-token", "billing_address", "urls"]) {
    assert.equal(persistedContract.includes(forbidden), false);
  }

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

test("facts v2 normalize provider lifecycle fields without retaining PII", async () => {
  const repository = new MemoryRepository();
  const parsed = JSON.parse(payload());
  parsed.data.attributes.pause = {
    mode: "free",
    resumes_at: "2026-08-01T10:00:00.000Z",
  };
  const rawBody = JSON.stringify(parsed);
  await ingestLemonSqueezyWebhook({
    rawBody,
    signature: sign(rawBody),
    webhookSecret: secret,
    repository,
  });
  assert.equal(repository.rows[0]?.subscriptionFacts?.providerStoreId, "440512");
  assert.equal(repository.rows[0]?.subscriptionFacts?.providerRenewsAt, "2026-08-28T10:00:00.000Z");
  assert.equal(repository.rows[0]?.subscriptionFacts?.providerCancelled, false);
  assert.equal(repository.rows[0]?.subscriptionFacts?.providerEndsAt, null);
  assert.equal(repository.rows[0]?.subscriptionFacts?.providerTrialEndsAt, null);
  assert.equal(repository.rows[0]?.subscriptionFacts?.providerPauseMode, "free");
  assert.equal(repository.rows[0]?.subscriptionFacts?.providerPauseResumesAt, "2026-08-01T10:00:00.000Z");
});

test("duplicate subscription_created retries a received durable event", async () => {
  let processorCalls = 0;
  const rawBody = payload();
  const repository: BillingWebhookEventRepository = {
    async insertEvent() {
      return { outcome: "duplicate", id: "durable-event", storedStatus: "received" };
    },
    async processSubscriptionCreated(eventId) {
      assert.equal(eventId, "durable-event");
      processorCalls += 1;
      return { outcome: "processed" };
    },
    async processSubscriptionUpdated() {
      return { outcome: "processed" };
    },
    async recordSubscriptionInvoiceEvidence() {
      return { outcome: "invoice_evidence_recorded", storedStatus: "processed" };
    },
  };
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({
      rawBody,
      signature: sign(rawBody),
      webhookSecret: secret,
      repository,
    }),
    { status: "processed" },
  );
  assert.equal(processorCalls, 1);
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
  assert.equal(repository.rows[0]?.subscriptionFacts, null);
});

test("payment success records PII-minimized initial, renewal and updated invoice evidence", async () => {
  for (const billingReason of ["initial", "renewal", "updated"] as const) {
    const repository = new MemoryRepository();
    const rawBody = paymentPayload("subscription_payment_success", `payment-${billingReason}`, { billing_reason: billingReason });
    assert.deepEqual(
      await ingestLemonSqueezyWebhook({
        rawBody,
        signature: sign(rawBody),
        webhookSecret: secret,
        repository,
        now: () => new Date("2026-07-28T11:00:00.000Z"),
      }),
      { status: "processed" },
    );
    assert.equal(repository.rows.length, 0);
    assert.equal(repository.invoiceRows.length, 1);
    assert.equal(repository.invoiceRows[0]?.eventName, "subscription_payment_success");
    assert.equal(repository.invoiceRows[0]?.providerObjectType, "subscription-invoices");
    assert.equal(repository.invoiceRows[0]?.invoiceFacts.billingReason, billingReason);
    assert.equal(repository.invoiceRows[0]?.invoiceFacts.invoiceStatus, "paid");
    assert.equal(repository.processorCalls, 0);
    const persisted = JSON.stringify(repository.invoiceRows[0]);
    for (const forbidden of ["not-persisted@example.test", "billing_address", "invoice_url", "private/invoice"]) {
      assert.equal(persisted.includes(forbidden), false);
    }
  }
});

test("payment failed and recovered remain ignored", async () => {
  for (const eventName of ["subscription_payment_failed", "subscription_payment_recovered"] as const) {
    const repository = new MemoryRepository();
    const rawBody = paymentPayload(eventName);
    assert.deepEqual(await ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository }), { status: "ignored" });
    assert.equal(repository.rows[0]?.processingStatus, "ignored");
    assert.equal(repository.invoiceRows.length, 0);
  }
});

test("subscription payment resend is a duplicate and never calls processor", async () => {
  const repository = new MemoryRepository();
  const original = paymentPayload("subscription_payment_success", "payment-delivery-a");
  const resend = paymentPayload("subscription_payment_success", "payment-delivery-b");
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({ rawBody: original, signature: sign(original), webhookSecret: secret, repository }),
    { status: "processed" },
  );
  assert.deepEqual(
    await ingestLemonSqueezyWebhook({ rawBody: resend, signature: sign(resend), webhookSecret: secret, repository }),
    { status: "duplicate" },
  );
  assert.equal(repository.invoiceRows.length, 1);
  assert.equal(repository.processorCalls, 0);
});

test("invoice evidence rejects mutation-grade invalid provider facts", async () => {
  type PaymentBody = { data: { type?: string; id?: unknown; attributes: Record<string, unknown> } };
  const cases: Array<[string, (body: PaymentBody) => void]> = [
    ["wrong resource", (body) => { body.data.type = "subscriptions"; }],
    ["missing invoice id", (body) => { delete body.data.id; }],
    ["invalid invoice id", (body) => { body.data.id = "invoice-81001"; }],
    ["invalid subscription id", (body) => { body.data.attributes.subscription_id = "bad"; }],
    ["invalid customer id", (body) => { body.data.attributes.customer_id = "bad"; }],
    ["invalid store id", (body) => { body.data.attributes.store_id = "bad"; }],
    ["unknown billing reason", (body) => { body.data.attributes.billing_reason = "manual"; }],
    ["incompatible status", (body) => { body.data.attributes.status = "pending"; }],
    ["malformed created at", (body) => { body.data.attributes.created_at = "bad"; }],
    ["malformed updated at", (body) => { body.data.attributes.updated_at = "bad"; }],
    ["timestamp inversion", (body) => { body.data.attributes.updated_at = "2026-07-28T10:58:00.000Z"; }],
  ];
  for (const [name, mutate] of cases) {
    const body = JSON.parse(paymentPayload()) as PaymentBody;
    mutate(body);
    const rawBody = JSON.stringify(body);
    await assert.rejects(
      ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository: new MemoryRepository() }),
      (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_PAYLOAD_INVALID",
      name,
    );
  }
});

test("invoice evidence rejects route environment mismatch before storage", async () => {
  const repository = new MemoryRepository();
  const rawBody = paymentPayload("subscription_payment_success", "live-mismatch", { test_mode: false });
  await assert.rejects(
    ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository }),
    (error: unknown) => error instanceof BillingWebhookError && error.code === "BILLING_WEBHOOK_ENVIRONMENT_MISMATCH",
  );
  assert.equal(repository.invoiceRows.length, 0);
});

test("same invoice facts are idempotent while conflicting facts become manual review", async () => {
  const repository = new MemoryRepository();
  const first = paymentPayload("subscription_payment_success", "delivery-one", { harmless_provider_field: "one" });
  const sameFacts = paymentPayload("subscription_payment_success", "delivery-two", { harmless_provider_field: "two" });
  const conflict = paymentPayload("subscription_payment_success", "delivery-three", { billing_reason: "updated" });
  assert.deepEqual(await ingestLemonSqueezyWebhook({ rawBody: first, signature: sign(first), webhookSecret: secret, repository }), { status: "processed" });
  assert.deepEqual(await ingestLemonSqueezyWebhook({ rawBody: sameFacts, signature: sign(sameFacts), webhookSecret: secret, repository }), { status: "duplicate" });
  assert.deepEqual(await ingestLemonSqueezyWebhook({ rawBody: conflict, signature: sign(conflict), webhookSecret: secret, repository }), { status: "manual_review" });
  assert.equal(repository.invoiceRows.length, 1);
  assert.equal(repository.processorCalls, 0);
});

test("transient invoice evidence storage failure is sanitized and remains provider-retryable", async () => {
  const repository = new MemoryRepository();
  repository.recordSubscriptionInvoiceEvidence = async () => { throw new Error("private invoice database detail 81001"); };
  const rawBody = paymentPayload();
  await assert.rejects(
    ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository }),
    (error: unknown) => error instanceof BillingWebhookError &&
      error.code === "BILLING_WEBHOOK_STORAGE_FAILED" && error.status === 503 &&
      !error.message.includes("81001"),
  );
  assert.equal(repository.invoiceRows.length, 0);
});

test("legacy and invalid custom data remain durable but never ready", async () => {
  const legacyRepository = new MemoryRepository();
  const legacy = payload("subscription_created", true, "legacy", {
    salon_id: "10000000-0000-4000-8000-000000000002",
    plan_code: "pro",
    idempotency_key: "10000000-0000-4000-8000-000000000003",
  });
  await ingestLemonSqueezyWebhook({ rawBody: legacy, signature: sign(legacy), webhookSecret: secret, repository: legacyRepository });
  assert.equal(legacyRepository.rows[0]?.subscriptionFacts?.correlationStatus, "legacy_missing_checkout_session");
  assert.equal(legacyRepository.rows[0]?.subscriptionFacts?.checkoutSessionId, null);
  assert.equal(legacyRepository.rows[0]?.subscriptionFacts?.correlationErrorCode, null);

  for (const customData of [
    { plan_code: "pro", idempotency_key: "10000000-0000-4000-8000-000000000003" },
    { salon_id: "10000000-0000-4000-8000-000000000002", plan_code: "premium", idempotency_key: "10000000-0000-4000-8000-000000000003" },
    { salon_id: "10000000-0000-4000-8000-000000000002", plan_code: "pro" },
  ]) {
    const repository = new MemoryRepository();
    const rawBody = payload("subscription_created", true, "legacy-invalid", customData);
    await ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository });
    assert.equal(repository.rows[0]?.subscriptionFacts?.correlationStatus, "invalid_custom_data");
  }

  for (const [field, value, code] of [
    ["checkout_session_id", "not-a-uuid", "checkout_session_id_invalid"],
    ["salon_id", "not-a-uuid", "custom_salon_id_invalid"],
    ["plan_code", "premium", "custom_plan_code_invalid"],
    ["idempotency_key", "not-a-uuid", "custom_idempotency_key_invalid"],
  ] as const) {
    const repository = new MemoryRepository();
    const custom = {
      checkout_session_id: "10000000-0000-4000-8000-000000000001",
      salon_id: "10000000-0000-4000-8000-000000000002",
      plan_code: "pro",
      idempotency_key: "10000000-0000-4000-8000-000000000003",
      [field]: value,
    };
    const rawBody = payload("subscription_created", true, `invalid-${field}`, custom);
    await ingestLemonSqueezyWebhook({ rawBody, signature: sign(rawBody), webhookSecret: secret, repository });
    assert.equal(repository.rows[0]?.subscriptionFacts?.correlationStatus, "invalid_custom_data");
    assert.equal(repository.rows[0]?.subscriptionFacts?.correlationErrorCode, code);
  }
});

test("repository failures remain a sanitized storage error", async () => {
  const rawBody = payload();
  await expectCode(
    () => ingestLemonSqueezyWebhook({
      rawBody,
      signature: sign(rawBody),
      webhookSecret: secret,
      repository: {
        async insertEvent() { throw new Error("private database detail"); },
        async processSubscriptionCreated() { return { outcome: "processed" as const }; },
        async processSubscriptionUpdated() { return { outcome: "processed" as const }; },
        async recordSubscriptionInvoiceEvidence() { throw new Error("private database detail"); },
      },
    }),
    "BILLING_WEBHOOK_STORAGE_FAILED",
  );
});

test("sequential and parallel duplicate deliveries create one row", async () => {
  const repository = new MemoryRepository();
  const rawBody = payload("subscription_updated");
  const input = { rawBody, signature: sign(rawBody), webhookSecret: secret, repository };
  const first = await ingestLemonSqueezyWebhook(input);
  const second = await ingestLemonSqueezyWebhook(input);
  assert.deepEqual(first, { status: "processed" });
  assert.deepEqual(second, { status: "duplicate" });

  const parallelBody = paymentPayload("subscription_payment_success");
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
  assert.deepEqual(results.map((result) => result.status).sort(), ["duplicate", "processed"]);
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.invoiceRows.length, 1);
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
    { status: "processed" },
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
  assert.deepEqual(results.map((result) => result.status).sort(), ["duplicate", "processed"]);

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

test("duplicate subscription_updated retries received state and dependency stays retryable", async () => {
  let updatedCalls = 0;
  const rawBody = payload("subscription_updated");
  const repository: BillingWebhookEventRepository = {
    async insertEvent() {
      return { outcome: "duplicate", id: "updated-event", storedStatus: "received" };
    },
    async processSubscriptionCreated() { return { outcome: "processed" }; },
    async processSubscriptionUpdated(eventId) {
      assert.equal(eventId, "updated-event");
      updatedCalls += 1;
      return { outcome: "dependency_pending" };
    },
    async recordSubscriptionInvoiceEvidence() {
      return { outcome: "invoice_evidence_recorded", storedStatus: "processed" };
    },
  };
  await expectCode(
    () => ingestLemonSqueezyWebhook({
      rawBody,
      signature: sign(rawBody),
      webhookSecret: secret,
      repository,
    }),
    "BILLING_WEBHOOK_STORAGE_FAILED",
  );
  assert.equal(updatedCalls, 1);
});

test("granular subscription events are ignored without facts or processor calls", async () => {
  for (const eventName of [
    "subscription_cancelled",
    "subscription_resumed",
    "subscription_expired",
    "subscription_paused",
    "subscription_unpaused",
    "subscription_plan_changed",
  ]) {
    const repository = new MemoryRepository();
    const rawBody = payload(eventName);
    const result = await ingestLemonSqueezyWebhook({
      rawBody,
      signature: sign(rawBody),
      webhookSecret: secret,
      repository,
    });
    assert.deepEqual(result, { status: "ignored" });
    assert.equal(repository.rows[0]?.subscriptionFacts, null);
    assert.equal(repository.rows[0]?.processingStatus, "ignored");
    assert.equal(repository.processorCalls, 0);
  }
});

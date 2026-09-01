import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { BillingWebhookError } from "./billingWebhookErrors.ts";
import {
  expectedLemonSqueezyTestMode,
  type BillingEnvironment,
} from "../config/billingEnvironment.ts";

export const LEMON_SQUEEZY_SUBSCRIPTION_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
]);
export const LEMON_SQUEEZY_INVOICE_EVIDENCE_EVENTS = new Set([
  "subscription_payment_success",
]);

const nonBlankString = z.string().refine((value) => value.trim().length > 0);

const envelopeSchema = z.object({
  meta: z.object({
    event_name: nonBlankString,
    webhook_id: nonBlankString.optional(),
    custom_data: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
  data: z.object({
    type: nonBlankString,
    id: nonBlankString,
    attributes: z.object({
      test_mode: z.boolean(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const providerIdSchema = z.union([
  nonBlankString,
  z.number().int().nonnegative(),
]).transform(String);

const canonicalInvoiceProviderIdSchema = z.union([
  z.string().regex(/^[1-9][0-9]*$/),
  z.number().int().positive().safe(),
]).transform(String);

const subscriptionInvoiceAttributesSchema = z.object({
  test_mode: z.boolean(),
  store_id: canonicalInvoiceProviderIdSchema,
  subscription_id: canonicalInvoiceProviderIdSchema,
  customer_id: canonicalInvoiceProviderIdSchema,
  billing_reason: z.enum(["initial", "renewal", "updated"]),
  status: z.literal("paid"),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).passthrough();

const subscriptionAttributesSchema = z.object({
  test_mode: z.boolean(),
  store_id: providerIdSchema,
  order_id: providerIdSchema,
  customer_id: providerIdSchema,
  product_id: providerIdSchema,
  variant_id: providerIdSchema,
  status: nonBlankString,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  renews_at: z.iso.datetime({ offset: true }).nullable(),
  ends_at: z.iso.datetime({ offset: true }).nullable(),
  cancelled: z.boolean(),
  trial_ends_at: z.iso.datetime({ offset: true }).nullable(),
  pause: z.object({
    mode: z.enum(["free", "void"]),
    resumes_at: z.iso.datetime({ offset: true }).nullable(),
  }).nullable(),
}).passthrough();

export type BillingWebhookSubscriptionFactsInput = {
  checkoutSessionId: string | null;
  customSalonId: string | null;
  customPlanCode: "starter" | "pro" | null;
  customIdempotencyKey: string | null;
  providerSubscriptionId: string;
  providerOrderId: string;
  providerCustomerId: string;
  providerProductId: string;
  providerVariantId: string;
  providerStatus: string;
  providerCreatedAt: string;
  providerUpdatedAt: string;
  providerStoreId: string;
  providerRenewsAt: string | null;
  providerEndsAt: string | null;
  providerCancelled: boolean;
  providerTrialEndsAt: string | null;
  providerPauseMode: "free" | "void" | null;
  providerPauseResumesAt: string | null;
  testMode: boolean;
  correlationStatus:
    | "ready"
    | "legacy_missing_checkout_session"
    | "invalid_custom_data";
  correlationErrorCode: string | null;
};

export type BillingWebhookEventInput = {
  provider: "lemonsqueezy";
  environment: BillingEnvironment;
  eventName: string;
  providerObjectType: string;
  providerObjectId: string;
  payloadHash: string;
  semanticFingerprint: string;
  processingStatus: "received" | "ignored";
  processedAt: string | null;
  testMode: boolean;
  subscriptionFacts: BillingWebhookSubscriptionFactsInput | null;
};

export type BillingWebhookSubscriptionInvoiceFactsInput = {
  providerInvoiceId: string;
  providerSubscriptionId: string;
  providerCustomerId: string;
  providerStoreId: string;
  billingReason: "initial" | "renewal" | "updated";
  invoiceStatus: "paid";
  providerInvoiceCreatedAt: string;
  providerInvoiceUpdatedAt: string;
  testMode: boolean;
};

export type BillingWebhookInvoiceEvidenceInput = Omit<
  BillingWebhookEventInput,
  "processingStatus" | "processedAt" | "subscriptionFacts"
> & {
  invoiceFacts: BillingWebhookSubscriptionInvoiceFactsInput;
};

export interface BillingWebhookEventRepository {
  insertEvent(
    input: BillingWebhookEventInput,
  ): Promise<{
    outcome: "inserted" | "duplicate";
    id: string;
    storedStatus: string;
  }>;
  processSubscriptionCreated(eventId: string): Promise<{
    outcome: "processed" | "already_processed" | "stale_ignored" | "manual_review";
  }>;
  processSubscriptionUpdated(eventId: string): Promise<{
    outcome:
      | "processed"
      | "already_processed"
      | "already_applied"
      | "stale_ignored"
      | "manual_review"
      | "dependency_pending";
  }>;
  recordSubscriptionInvoiceEvidence(
    input: BillingWebhookInvoiceEvidenceInput,
  ): Promise<{
    outcome:
      | "invoice_evidence_recorded"
      | "invoice_evidence_already_recorded"
      | "invoice_evidence_conflict";
    storedStatus: "processed" | "manual_review";
  }>;
}

export function verifyLemonSqueezyWebhookSignature(input: {
  rawBody: string;
  signature: string;
  webhookSecret: string;
}) {
  if (!input.rawBody || !/^[0-9a-fA-F]+$/.test(input.signature)) return false;
  if (input.signature.length % 2 !== 0) return false;

  const expected = createHmac("sha256", input.webhookSecret)
    .update(input.rawBody)
    .digest();
  const received = Buffer.from(input.signature, "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key]!)}`)
    .join(",")}}`;
}

export function createLemonSqueezySemanticFingerprint(
  payload: z.infer<typeof envelopeSchema>,
) {
  const semanticMeta = { ...payload.meta };
  delete semanticMeta.webhook_id;
  const semanticPayload = {
    ...payload,
    meta: semanticMeta,
  } as JsonValue;
  return createHash("sha256")
    .update(canonicalizeJson(semanticPayload))
    .digest("hex");
}

const uuidSchema = z.uuid();

function normalizedUuid(value: unknown) {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeLemonSqueezySubscriptionFacts(
  payload: z.infer<typeof envelopeSchema>,
): BillingWebhookSubscriptionFactsInput {
  const attributes = subscriptionAttributesSchema.safeParse(
    payload.data.attributes,
  );
  if (!attributes.success) {
    throw new BillingWebhookError("BILLING_WEBHOOK_PAYLOAD_INVALID", 400);
  }

  const custom = payload.meta.custom_data ?? {};
  const hasCheckoutSessionId = Object.prototype.hasOwnProperty.call(
    custom,
    "checkout_session_id",
  );
  const checkoutSessionId = normalizedUuid(custom.checkout_session_id);
  const customSalonId = normalizedUuid(custom.salon_id);
  const customIdempotencyKey = normalizedUuid(custom.idempotency_key);
  const customPlanCode =
    custom.plan_code === "starter" || custom.plan_code === "pro"
      ? custom.plan_code
      : null;

  let correlationStatus: BillingWebhookSubscriptionFactsInput["correlationStatus"];
  let correlationErrorCode: string | null;
  if (!hasCheckoutSessionId) {
    if (!customSalonId) {
      correlationStatus = "invalid_custom_data";
      correlationErrorCode = "custom_salon_id_invalid";
    } else if (!customPlanCode) {
      correlationStatus = "invalid_custom_data";
      correlationErrorCode = "custom_plan_code_invalid";
    } else if (!customIdempotencyKey) {
      correlationStatus = "invalid_custom_data";
      correlationErrorCode = "custom_idempotency_key_invalid";
    } else {
      correlationStatus = "legacy_missing_checkout_session";
      correlationErrorCode = null;
    }
  } else if (!checkoutSessionId) {
    correlationStatus = "invalid_custom_data";
    correlationErrorCode = "checkout_session_id_invalid";
  } else if (!customSalonId) {
    correlationStatus = "invalid_custom_data";
    correlationErrorCode = "custom_salon_id_invalid";
  } else if (!customPlanCode) {
    correlationStatus = "invalid_custom_data";
    correlationErrorCode = "custom_plan_code_invalid";
  } else if (!customIdempotencyKey) {
    correlationStatus = "invalid_custom_data";
    correlationErrorCode = "custom_idempotency_key_invalid";
  } else {
    correlationStatus = "ready";
    correlationErrorCode = null;
  }

  return {
    checkoutSessionId,
    customSalonId,
    customPlanCode,
    customIdempotencyKey,
    providerSubscriptionId: payload.data.id,
    providerOrderId: attributes.data.order_id,
    providerCustomerId: attributes.data.customer_id,
    providerProductId: attributes.data.product_id,
    providerVariantId: attributes.data.variant_id,
    providerStatus: attributes.data.status,
    providerCreatedAt: attributes.data.created_at,
    providerUpdatedAt: attributes.data.updated_at,
    providerStoreId: attributes.data.store_id,
    providerRenewsAt: attributes.data.renews_at,
    providerEndsAt: attributes.data.ends_at,
    providerCancelled: attributes.data.cancelled,
    providerTrialEndsAt: attributes.data.trial_ends_at,
    providerPauseMode: attributes.data.pause?.mode ?? null,
    providerPauseResumesAt: attributes.data.pause?.resumes_at ?? null,
    testMode: attributes.data.test_mode,
    correlationStatus,
    correlationErrorCode,
  };
}

export function normalizeLemonSqueezySubscriptionInvoiceFacts(
  payload: z.infer<typeof envelopeSchema>,
): BillingWebhookSubscriptionInvoiceFactsInput {
  if (payload.data.type !== "subscription-invoices") {
    throw new BillingWebhookError("BILLING_WEBHOOK_PAYLOAD_INVALID", 400);
  }
  const invoiceId = canonicalInvoiceProviderIdSchema.safeParse(payload.data.id);
  const attributes = subscriptionInvoiceAttributesSchema.safeParse(payload.data.attributes);
  if (!invoiceId.success || !attributes.success) {
    throw new BillingWebhookError("BILLING_WEBHOOK_PAYLOAD_INVALID", 400);
  }
  if (Date.parse(attributes.data.updated_at) < Date.parse(attributes.data.created_at)) {
    throw new BillingWebhookError("BILLING_WEBHOOK_PAYLOAD_INVALID", 400);
  }
  return {
    providerInvoiceId: invoiceId.data,
    providerSubscriptionId: attributes.data.subscription_id,
    providerCustomerId: attributes.data.customer_id,
    providerStoreId: attributes.data.store_id,
    billingReason: attributes.data.billing_reason,
    invoiceStatus: attributes.data.status,
    providerInvoiceCreatedAt: attributes.data.created_at,
    providerInvoiceUpdatedAt: attributes.data.updated_at,
    testMode: attributes.data.test_mode,
  };
}

export async function ingestLemonSqueezyWebhook(input: {
  rawBody: string;
  signature: string | null;
  webhookSecret: string;
  environment: BillingEnvironment;
  repository: BillingWebhookEventRepository;
  now?: () => Date;
}) {
  if (!input.signature) {
    throw new BillingWebhookError("BILLING_WEBHOOK_SIGNATURE_MISSING", 401);
  }
  if (
    !verifyLemonSqueezyWebhookSignature({
      rawBody: input.rawBody,
      signature: input.signature,
      webhookSecret: input.webhookSecret,
    })
  ) {
    throw new BillingWebhookError("BILLING_WEBHOOK_SIGNATURE_INVALID", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    throw new BillingWebhookError("BILLING_WEBHOOK_PAYLOAD_INVALID", 400);
  }
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BillingWebhookError("BILLING_WEBHOOK_PAYLOAD_INVALID", 400);
  }
  if (
    parsed.data.data.attributes.test_mode !==
    expectedLemonSqueezyTestMode(input.environment)
  ) {
    throw new BillingWebhookError(
      "BILLING_WEBHOOK_ENVIRONMENT_MISMATCH",
      400,
    );
  }

  const supportedSubscription = LEMON_SQUEEZY_SUBSCRIPTION_EVENTS.has(
    parsed.data.meta.event_name,
  );
  const supportedInvoiceEvidence = LEMON_SQUEEZY_INVOICE_EVIDENCE_EVENTS.has(
    parsed.data.meta.event_name,
  );
  const processingStatus = supportedSubscription ? "received" : "ignored";
  const subscriptionFacts = supportedSubscription
    ? normalizeLemonSqueezySubscriptionFacts(parsed.data)
    : null;
  const commonEvent = {
    provider: "lemonsqueezy" as const,
    environment: input.environment,
    eventName: parsed.data.meta.event_name,
    providerObjectType: parsed.data.data.type,
    providerObjectId: parsed.data.data.id,
    payloadHash: createHash("sha256").update(input.rawBody).digest("hex"),
    semanticFingerprint: createLemonSqueezySemanticFingerprint(parsed.data),
    testMode: parsed.data.data.attributes.test_mode,
  };
  if (supportedInvoiceEvidence) {
    const invoiceFacts = normalizeLemonSqueezySubscriptionInvoiceFacts(parsed.data);
    try {
      const recorded = await input.repository.recordSubscriptionInvoiceEvidence({
        ...commonEvent,
        invoiceFacts,
      });
      if (recorded.outcome === "invoice_evidence_already_recorded") {
        return { status: "duplicate" as const };
      }
      if (recorded.outcome === "invoice_evidence_conflict") {
        return { status: "manual_review" as const };
      }
      return { status: "processed" as const };
    } catch {
      throw new BillingWebhookError("BILLING_WEBHOOK_STORAGE_FAILED", 503);
    }
  }
  let stored: Awaited<ReturnType<BillingWebhookEventRepository["insertEvent"]>>;
  try {
    stored = await input.repository.insertEvent({
      ...commonEvent,
      processingStatus,
      processedAt: supportedSubscription ? null : (input.now?.() ?? new Date()).toISOString(),
      subscriptionFacts,
    });
  } catch {
    throw new BillingWebhookError("BILLING_WEBHOOK_STORAGE_FAILED", 503);
  }

  if (
    parsed.data.meta.event_name === "subscription_created" &&
    stored.storedStatus === "received"
  ) {
    try {
      const processed = await input.repository.processSubscriptionCreated(stored.id);
      if (processed.outcome === "already_processed") {
        return { status: "duplicate" as const };
      }
      return { status: processed.outcome };
    } catch {
      throw new BillingWebhookError("BILLING_WEBHOOK_STORAGE_FAILED", 503);
    }
  }
  if (
    parsed.data.meta.event_name === "subscription_updated" &&
    stored.storedStatus === "received"
  ) {
    try {
      const processed = await input.repository.processSubscriptionUpdated(stored.id);
      if (processed.outcome === "dependency_pending") {
        throw new BillingWebhookError("BILLING_WEBHOOK_STORAGE_FAILED", 503);
      }
      if (processed.outcome === "already_processed") {
        return { status: "duplicate" as const };
      }
      return { status: processed.outcome };
    } catch (error) {
      if (error instanceof BillingWebhookError) throw error;
      throw new BillingWebhookError("BILLING_WEBHOOK_STORAGE_FAILED", 503);
    }
  }
  if (stored.storedStatus === "manual_review") {
    return { status: "manual_review" as const };
  }
  if (stored.outcome === "duplicate") return { status: "duplicate" as const };
  return { status: processingStatus };
}

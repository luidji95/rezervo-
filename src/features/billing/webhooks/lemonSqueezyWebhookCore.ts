import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { BillingWebhookError } from "./billingWebhookErrors.ts";

export const LEMON_SQUEEZY_SUBSCRIPTION_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_payment_failed",
  "subscription_payment_success",
  "subscription_payment_recovered",
  "subscription_plan_changed",
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

export type BillingWebhookEventInput = {
  provider: "lemonsqueezy";
  environment: "test";
  eventName: string;
  providerObjectType: string;
  providerObjectId: string;
  payloadHash: string;
  semanticFingerprint: string;
  processingStatus: "received" | "ignored";
  processedAt: string | null;
};

export interface BillingWebhookEventRepository {
  insertEvent(
    input: BillingWebhookEventInput,
  ): Promise<{ outcome: "inserted"; id: string } | { outcome: "duplicate" }>;
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

export async function ingestLemonSqueezyWebhook(input: {
  rawBody: string;
  signature: string | null;
  webhookSecret: string;
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
  if (parsed.data.data.attributes.test_mode !== true) {
    throw new BillingWebhookError(
      "BILLING_WEBHOOK_ENVIRONMENT_MISMATCH",
      400,
    );
  }

  const supported = LEMON_SQUEEZY_SUBSCRIPTION_EVENTS.has(
    parsed.data.meta.event_name,
  );
  const processingStatus = supported ? "received" : "ignored";
  let stored:
    | { outcome: "inserted"; id: string }
    | { outcome: "duplicate" };
  try {
    stored = await input.repository.insertEvent({
      provider: "lemonsqueezy",
      environment: "test",
      eventName: parsed.data.meta.event_name,
      providerObjectType: parsed.data.data.type,
      providerObjectId: parsed.data.data.id,
      payloadHash: createHash("sha256").update(input.rawBody).digest("hex"),
      semanticFingerprint: createLemonSqueezySemanticFingerprint(parsed.data),
      processingStatus,
      processedAt: supported ? null : (input.now?.() ?? new Date()).toISOString(),
    });
  } catch {
    throw new BillingWebhookError("BILLING_WEBHOOK_STORAGE_FAILED", 503);
  }

  if (stored.outcome === "duplicate") {
    return { status: "duplicate" as const };
  }
  return { status: processingStatus };
}

import {
  BillingCheckoutRecoveryConfigError,
  verifyBillingCheckoutRecoveryAuthorization,
  type BillingCheckoutRecoveryConfig,
} from "./billingCheckoutRecoveryConfig.ts";
import type { BillingCheckoutRecoveryOutcome } from "./billingCheckoutRecoveryCore.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 512;
export type BillingCheckoutRecoveryHttpOutcome = BillingCheckoutRecoveryOutcome | "unauthorized" | "invalid_request" | "internal_error";
export type BillingCheckoutRecoveryEndpointResult = {
  status: number;
  body: { success: boolean; outcome: BillingCheckoutRecoveryHttpOutcome };
  headers: { "Cache-Control": "no-store" };
};

function result(status: number, success: boolean, outcome: BillingCheckoutRecoveryHttpOutcome): BillingCheckoutRecoveryEndpointResult {
  return { status, body: { success, outcome }, headers: { "Cache-Control": "no-store" } };
}

function contentTypeIsJson(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function parseRequestBody(raw: string): string | null {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  return keys.length === 1 && keys[0] === "checkoutSessionId" &&
    typeof object.checkoutSessionId === "string" && UUID_PATTERN.test(object.checkoutSessionId)
    ? object.checkoutSessionId
    : null;
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) return null;
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed > MAX_BODY_BYTES) return null;
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    if (!request.body) return "";
    reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* Invalid request remains sanitized. */ }
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return null; }
  } catch {
    return null;
  } finally {
    if (reader) {
      try { reader.releaseLock(); } catch { /* Cleanup must not escape the HTTP contract. */ }
    }
  }
}

export async function handleBillingCheckoutRecoveryRequest(input: {
  request: Request;
  getConfig: () => BillingCheckoutRecoveryConfig;
  runRecovery: (checkoutSessionId: string, config: BillingCheckoutRecoveryConfig) => Promise<BillingCheckoutRecoveryOutcome>;
}): Promise<BillingCheckoutRecoveryEndpointResult> {
  let config: BillingCheckoutRecoveryConfig;
  try { config = input.getConfig(); }
  catch (error) {
    return error instanceof BillingCheckoutRecoveryConfigError
      ? result(503, false, "configuration_error")
      : result(500, false, "internal_error");
  }
  if (!verifyBillingCheckoutRecoveryAuthorization(input.request.headers.get("authorization"), config.secret)) {
    return result(401, false, "unauthorized");
  }
  const url = new URL(input.request.url);
  if (url.search || !contentTypeIsJson(input.request.headers.get("content-type"))) {
    return result(400, false, "invalid_request");
  }
  const rawBody = await readBoundedBody(input.request);
  const checkoutSessionId = rawBody === null ? null : parseRequestBody(rawBody);
  if (!checkoutSessionId) return result(400, false, "invalid_request");

  try {
    const outcome = await input.runRecovery(checkoutSessionId, config);
    switch (outcome) {
      case "already_open": case "already_completed": case "still_pending":
        return result(200, true, outcome);
      case "provider_not_found": case "invalid_candidate": case "ambiguous":
      case "pagination_limit_reached": case "manual_review": case "invalid_provider_response":
        return result(200, false, outcome);
      case "claim_lost": case "already_claimed":
        return result(409, false, outcome);
      case "provider_unavailable": case "configuration_error":
        return result(503, false, outcome);
    }
  } catch {
    return result(500, false, "internal_error");
  }
}

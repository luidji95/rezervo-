import {
  normalizeLemonSqueezySubscriptionObject,
  type NormalizedLemonSqueezySubscription,
} from "../lemonSqueezy/lemonSqueezySubscriptionObjectCore.ts";
import { expectedLemonSqueezyTestMode, type BillingEnvironment } from "../config/billingEnvironment.ts";

const API_BASE = "https://api.lemonsqueezy.com/v1/subscriptions/";
const JSON_API = "application/vnd.api+json";
// Numeric provider IDs that stay exact as a JSON number (variant_id is sent as a number).
const PROVIDER_ID = /^[1-9]\d{0,14}$/;
export const PLAN_CHANGE_PROVIDER_TIMEOUT_MS = 10_000;
export const PLAN_CHANGE_MAX_RESPONSE_BYTES = 64 * 1024;

export type PlanChangeProviderSnapshot = NormalizedLemonSqueezySubscription & {
  /** Raw `payment_processor` attribute; only "stripe" is supported by this API flow. */
  paymentProcessor: string | null;
};

/** GET is read-only: any failure is just "unavailable" and never implies anything about a change. */
export type PlanChangeReadResult = { kind: "snapshot"; snapshot: PlanChangeProviderSnapshot } | { kind: "unavailable" };

/**
 * PATCH outcome. There is no proven allowlist of provider responses that prove a change was NOT
 * applied, so every non-accepted outcome after dispatch (timeout, transport failure, redirect,
 * 429, 4xx, 5xx, invalid or foreign body) is "ambiguous". "accepted" is neither payment nor
 * completion; it only carries the provider state for the database evidence contract.
 */
export type PlanChangePatchResult = { kind: "accepted"; snapshot: PlanChangeProviderSnapshot } | { kind: "ambiguous" };

export interface BillingPlanChangeProvider {
  readSubscription(providerSubscriptionId: string): Promise<PlanChangeReadResult>;
  /** Sends exactly one PATCH. Never retried here; callers must hold the database dispatch right. */
  patchVariant(providerSubscriptionId: string, variantId: string): Promise<PlanChangePatchResult>;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > PLAN_CHANGE_MAX_RESPONSE_BYTES)) throw new Error("too_large");
  if (!response.body) throw new Error("empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PLAN_CHANGE_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export function parsePlanChangeSnapshot(payload: unknown): PlanChangeProviderSnapshot {
  const snapshot = normalizeLemonSqueezySubscriptionObject(payload);
  const attributes = (payload as { data: { attributes: Record<string, unknown> } }).data.attributes;
  const processor = attributes.payment_processor;
  return { ...snapshot, paymentProcessor: typeof processor === "string" ? processor : null };
}

export class LemonSqueezyPlanChangeProvider implements BillingPlanChangeProvider {
  private readonly config: { environment: BillingEnvironment; apiKey: string; storeId: string };
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    config: { environment: BillingEnvironment; apiKey: string; storeId: string },
    fetchImpl: typeof fetch = fetch,
    timeoutMs = PLAN_CHANGE_PROVIDER_TIMEOUT_MS,
  ) { this.config = config; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }

  /** Same subscription, configured store and environment test mode; anything else is not usable evidence. */
  private ownSnapshot(payload: unknown, providerSubscriptionId: string): PlanChangeProviderSnapshot | null {
    try {
      const snapshot = parsePlanChangeSnapshot(payload);
      return snapshot.providerSubscriptionId === providerSubscriptionId
        && snapshot.providerStoreId === this.config.storeId
        && snapshot.testMode === expectedLemonSqueezyTestMode(this.config.environment)
        ? snapshot : null;
    } catch {
      return null;
    }
  }

  private async send(method: "GET" | "PATCH", providerSubscriptionId: string, body?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${API_BASE}${encodeURIComponent(providerSubscriptionId)}`, {
        method,
        headers: { Accept: JSON_API, "Content-Type": JSON_API, Authorization: `Bearer ${this.config.apiKey}` },
        body,
        cache: "no-store",
        // A redirect could re-issue the mutation elsewhere; it is never followed.
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status < 200 || response.status > 299) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      return this.ownSnapshot(await readBoundedJson(response), providerSubscriptionId);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async readSubscription(providerSubscriptionId: string): Promise<PlanChangeReadResult> {
    if (!PROVIDER_ID.test(providerSubscriptionId)) return { kind: "unavailable" };
    const snapshot = await this.send("GET", providerSubscriptionId);
    return snapshot ? { kind: "snapshot", snapshot } : { kind: "unavailable" };
  }

  async patchVariant(providerSubscriptionId: string, variantId: string): Promise<PlanChangePatchResult> {
    // Invalid identifiers are refused by the caller before the dispatch right is taken; here they
    // still count as ambiguous because the caller already holds that right.
    if (!PROVIDER_ID.test(providerSubscriptionId) || !PROVIDER_ID.test(variantId)) return { kind: "ambiguous" };
    const body = JSON.stringify({
      data: {
        type: "subscriptions",
        id: providerSubscriptionId,
        attributes: { variant_id: Number(variantId), disable_prorations: true },
      },
    });
    const snapshot = await this.send("PATCH", providerSubscriptionId, body);
    return snapshot ? { kind: "accepted", snapshot } : { kind: "ambiguous" };
  }
}

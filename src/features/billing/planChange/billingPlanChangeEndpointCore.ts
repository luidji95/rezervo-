import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type { BillingPlanChangeConfig } from "./billingPlanChangeConfigCore.ts";
import {
  refreshPlanChange,
  requestPlanChange,
  type BillingPlanChangeRepository,
  type PlanChangeOutcome,
  type PlanChangeRecord,
} from "./billingPlanChangeCore.ts";
import { BillingPlanChangeError, type BillingPlanChangeErrorCode } from "./billingPlanChangeErrors.ts";
import type { BillingPlanChangeProvider } from "./lemonSqueezyPlanChangeProvider.ts";

const MAX_BODY_BYTES = 256;

export type PlanChangeEndpointDependencies = {
  /** Verified session user id; null when the request is not authenticated. */
  authenticate(request: Request): Promise<string | null>;
  getConfig(): BillingPlanChangeConfig | null;
  /** Database runtime environment parity (billing_environment_matches_v1). */
  environmentMatches(environment: BillingEnvironment): Promise<boolean>;
  repository: BillingPlanChangeRepository;
  getProvider(config: BillingPlanChangeConfig): BillingPlanChangeProvider;
  now(): Date;
};

/** User-facing state; deliberately coarse. "completed" only when the database completed the change. */
export type PlanChangeView = {
  id: string;
  state: "pending_confirmation" | "scheduled" | "review_required" | "completed" | "not_applied" | "abandoned";
  direction: "upgrade" | "downgrade";
  targetPlan: "starter" | "pro" | null;
  /** Immutable effective date (the paid period end at request time). */
  effectiveAt: string;
  nextAction: "none" | "check_status_later" | "contact_support";
};

export type PlanChangeEndpointResult = {
  status: number;
  body:
    | { success: false; code: BillingPlanChangeErrorCode }
    | { success: true; outcome: PlanChangeOutcome["outcome"]; planChange: PlanChangeView | null; doNotRepeat: boolean };
  headers: { "Cache-Control": "no-store" };
};

const headers = { "Cache-Control": "no-store" } as const;
const failure = (code: BillingPlanChangeErrorCode, status: number): PlanChangeEndpointResult => ({ status, body: { success: false, code }, headers });

export function toPlanChangeView(change: PlanChangeRecord): PlanChangeView {
  const state: PlanChangeView["state"] = change.status === "requested" || change.status === "unknown" ? "pending_confirmation"
    : change.status === "confirmed" ? "scheduled"
    : change.status === "manual_review" ? "review_required"
    : change.status;
  return {
    id: change.id,
    state,
    direction: change.direction,
    targetPlan: change.targetPlan,
    effectiveAt: change.baselinePeriodEnd,
    nextAction: state === "pending_confirmation" ? "check_status_later" : state === "review_required" ? "contact_support" : "none",
  };
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel().catch(() => undefined); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    try { reader.releaseLock(); } catch { /* sanitized */ }
  }
}

/** Only {"targetPlan":"starter"|"pro"}; provider, store, subscription, variant and environment are never accepted. */
function parseRequestBody(raw: string): "starter" | "pro" | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const target = (value as Record<string, unknown>).targetPlan;
  return keys.length === 1 && keys[0] === "targetPlan" && (target === "starter" || target === "pro") ? target : null;
}

function isJson(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function success(result: PlanChangeOutcome): PlanChangeEndpointResult {
  const status = result.outcome === "requested" || result.outcome === "status_unknown" ? 202 : 200;
  return {
    status,
    body: {
      success: true,
      outcome: result.outcome,
      planChange: result.change ? toPlanChangeView(result.change) : null,
      // An unknown or pending outcome must never invite a second change or purchase.
      doNotRepeat: result.outcome !== "none",
    },
    headers,
  };
}

export async function handleBillingPlanChangePost(
  mode: "request" | "refresh",
  request: Request,
  dependencies: PlanChangeEndpointDependencies,
): Promise<PlanChangeEndpointResult> {
  try {
    const userId = await dependencies.authenticate(request);
    if (!userId) return failure("BILLING_PLAN_CHANGE_UNAUTHORIZED", 401);
    if (new URL(request.url).search) return failure("BILLING_PLAN_CHANGE_REQUEST_INVALID", 400);
    const raw = await readBoundedBody(request);
    if (raw === null) return failure("BILLING_PLAN_CHANGE_REQUEST_INVALID", 400);
    let targetPlan: "starter" | "pro" | null = null;
    if (mode === "request") {
      targetPlan = isJson(request) ? parseRequestBody(raw) : null;
      if (!targetPlan) return failure("BILLING_PLAN_CHANGE_REQUEST_INVALID", 400);
    } else if (raw.trim() !== "" && raw.trim() !== "{}") {
      return failure("BILLING_PLAN_CHANGE_REQUEST_INVALID", 400);
    }

    // Flag, trusted configuration and database parity are all checked before any provider call;
    // the response does not reveal which of them is missing.
    const config = dependencies.getConfig();
    if (!config) return failure("BILLING_PLAN_CHANGE_DISABLED", 503);
    let parity = false;
    try { parity = await dependencies.environmentMatches(config.environment); } catch { parity = false; }
    if (parity !== true) return failure("BILLING_PLAN_CHANGE_DISABLED", 503);

    const core = {
      repository: dependencies.repository,
      provider: dependencies.getProvider(config),
      environment: config.environment,
      storeId: config.storeId,
      now: dependencies.now,
    };
    const result = mode === "request"
      ? await requestPlanChange({ userId, targetPlan: targetPlan! }, core)
      : await refreshPlanChange({ userId }, core);
    return success(result);
  } catch (error) {
    if (error instanceof BillingPlanChangeError) return failure(error.code, error.status);
    return failure("BILLING_PLAN_CHANGE_INTERNAL_ERROR", 500);
  }
}

import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import { BillingPlanChangeError } from "./billingPlanChangeErrors.ts";
import type { BillingPlanChangeProvider, PlanChangeProviderSnapshot } from "./lemonSqueezyPlanChangeProvider.ts";

export type PlanChangeTarget = "starter" | "pro";
export type PlanChangeStatus = "requested" | "unknown" | "confirmed" | "manual_review" | "completed" | "not_applied" | "abandoned";
export const BLOCKING_PLAN_CHANGE_STATUSES: ReadonlySet<PlanChangeStatus> = new Set(["requested", "unknown", "confirmed", "manual_review"]);

/** Server-side view of the latest change of a salon (contains internal identifiers; never sent as-is). */
export type PlanChangeRecord = {
  id: string;
  subscriptionId: string;
  providerSubscriptionId: string;
  /** Expected provider customer recorded with the change (authoritative, never from the browser). */
  providerCustomerId: string;
  status: PlanChangeStatus;
  direction: "upgrade" | "downgrade";
  targetPlan: PlanChangeTarget | null;
  baselinePeriodEnd: string;
  conflictCode: string | null;
};

export type PlanChangePrepareRow = {
  outcome: "eligible" | "rejected";
  errorCode: string | null;
  subscriptionId: string | null;
  providerSubscriptionId: string | null;
  baselinePeriodEnd: string | null;
  targetProviderVariantId: string | null;
  stateToken: string | null;
};

export type PlanChangeProviderEvidence = {
  providerSubscriptionId: string;
  providerCustomerId: string;
  providerStoreId: string;
  testMode: boolean;
  providerProductId: string;
  providerVariantId: string;
  providerStatus: string;
  providerCancelled: boolean;
  providerPauseMode: string | null;
  providerTrialEndsAt: string | null;
  providerRenewsAt: string | null;
  providerEndsAt: string | null;
  providerUpdatedAt: string;
};

/** A stable error code raised by a plan-change RPC (the RPC refused; nothing was recorded). */
export class PlanChangeDatabaseRejection extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "PlanChangeDatabaseRejection"; this.code = code; }
}

export interface BillingPlanChangeRepository {
  /** Salon owned by the verified user: its id, "forbidden" when the user owns none, null when ambiguous. */
  findOwnedSalon(userId: string): Promise<string | "forbidden" | null>;
  findActivePlanId(slug: PlanChangeTarget): Promise<string | null>;
  /** Provider customer of the local provider-linked subscription; null when not available. */
  findProviderCustomerId(subscriptionId: string): Promise<string | null>;
  prepare(input: { salonId: string; actorProfileId: string; targetPlanId: string; now: string }): Promise<PlanChangePrepareRow>;
  /** Throws PlanChangeDatabaseRejection for a refused request; any other throw is an unknown outcome. */
  request(input: { salonId: string; actorProfileId: string; targetPlanId: string; stateToken: string; evidence: PlanChangeProviderEvidence; checkedAt: string; now: string }): Promise<{ planChangeId: string; targetProviderVariantId: string }>;
  record(input: { environment: BillingEnvironment; planChangeId: string; result: "accepted" | "ambiguous" | "observed"; evidence: PlanChangeProviderEvidence | null; now: string }): Promise<void>;
  evaluate(input: { environment: BillingEnvironment; subscriptionId: string; now: string }): Promise<void>;
  latestChange(salonId: string): Promise<PlanChangeRecord | null>;
}

export type PlanChangeDependencies = {
  repository: BillingPlanChangeRepository;
  provider: BillingPlanChangeProvider;
  environment: BillingEnvironment;
  storeId: string;
  now(): Date;
};

export type PlanChangeOutcome =
  /** This call held the dispatch right, sent the single PATCH and recorded its classified result. */
  | { outcome: "requested"; change: PlanChangeRecord | null }
  /** Another request already holds the dispatch right; nothing was sent by this call. */
  | { outcome: "already_pending"; change: PlanChangeRecord | null }
  /** The intent or the provider result could not be confirmed as recorded. Do not repeat the request. */
  | { outcome: "status_unknown"; change: PlanChangeRecord | null }
  | { outcome: "current"; change: PlanChangeRecord; providerChecked: boolean }
  | { outcome: "none"; change: null };

const REQUEST_REJECTIONS: Record<string, [ConstructorParameters<typeof BillingPlanChangeError>[0], number]> = {
  BILLING_PLAN_CHANGE_FORBIDDEN: ["BILLING_PLAN_CHANGE_FORBIDDEN", 403],
  BILLING_PLAN_CHANGE_TARGET_INVALID: ["BILLING_PLAN_CHANGE_REQUEST_INVALID", 400],
  BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE: ["BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE", 409],
  EMPLOYEE_OVER_TARGET_LIMIT: ["BILLING_PLAN_CHANGE_EMPLOYEES_OVER_TARGET", 409],
  BILLING_SUBSCRIPTION_PAYMENT_REQUIRED: ["BILLING_PLAN_CHANGE_PAYMENT_REQUIRED", 409],
  BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED: ["BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED", 409],
  BILLING_PURCHASE_ACTIVATION_PENDING: ["BILLING_PLAN_CHANGE_PURCHASE_PENDING", 409],
  BILLING_PLAN_CHANGE_STATE_CHANGED: ["BILLING_PLAN_CHANGE_STATE_CHANGED", 409],
  BILLING_PLAN_CHANGE_PROVIDER_STATE_MISMATCH: ["BILLING_PLAN_CHANGE_STATE_CHANGED", 409],
  BILLING_PLAN_CHANGE_PROVIDER_EVIDENCE_STALE: ["BILLING_PLAN_CHANGE_STATE_CHANGED", 409],
  BILLING_PLAN_CHANGE_ENVIRONMENT_MISMATCH: ["BILLING_PLAN_CHANGE_DISABLED", 503],
  BILLING_PLAN_CHANGE_MAPPING_INVALID: ["BILLING_PLAN_CHANGE_DISABLED", 503],
};

function rejection(code: string | null): BillingPlanChangeError {
  const mapped = code ? REQUEST_REJECTIONS[code] : undefined;
  return mapped ? new BillingPlanChangeError(mapped[0], mapped[1]) : new BillingPlanChangeError("BILLING_PLAN_CHANGE_NOT_ELIGIBLE", 409);
}

export function toProviderEvidence(snapshot: PlanChangeProviderSnapshot): PlanChangeProviderEvidence {
  return {
    providerSubscriptionId: snapshot.providerSubscriptionId,
    providerCustomerId: snapshot.providerCustomerId,
    providerStoreId: snapshot.providerStoreId,
    testMode: snapshot.testMode,
    providerProductId: snapshot.providerProductId,
    providerVariantId: snapshot.providerVariantId,
    providerStatus: snapshot.providerStatus,
    providerCancelled: snapshot.providerCancelled,
    providerPauseMode: snapshot.providerPauseMode,
    providerTrialEndsAt: snapshot.providerTrialEndsAt,
    providerRenewsAt: snapshot.providerRenewsAt,
    providerEndsAt: snapshot.providerEndsAt,
    providerUpdatedAt: snapshot.providerUpdatedAt,
  };
}

const sameInstant = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b);

async function ownedSalon(repository: BillingPlanChangeRepository, userId: string) {
  const salon = await repository.findOwnedSalon(userId);
  if (salon === "forbidden") throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_FORBIDDEN", 403);
  if (!salon) throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_NOT_ELIGIBLE", 409);
  return salon;
}

async function latestOrNull(repository: BillingPlanChangeRepository, salonId: string) {
  try { return await repository.latestChange(salonId); } catch { return null; }
}

/** Owner request: prepare -> provider GET -> durable intent -> exactly one PATCH -> recorded result. */
export async function requestPlanChange(
  input: { userId: string; targetPlan: PlanChangeTarget },
  dependencies: PlanChangeDependencies,
): Promise<PlanChangeOutcome> {
  const { repository, provider } = dependencies;
  const salonId = await ownedSalon(repository, input.userId);
  const targetPlanId = await repository.findActivePlanId(input.targetPlan);
  if (!targetPlanId) throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_REQUEST_INVALID", 400);

  const prepared = await repository.prepare({ salonId, actorProfileId: input.userId, targetPlanId, now: dependencies.now().toISOString() });
  if (prepared.outcome !== "eligible") {
    if (prepared.errorCode === "BILLING_PLAN_CHANGE_PENDING") return { outcome: "already_pending", change: await latestOrNull(repository, salonId) };
    throw rejection(prepared.errorCode);
  }
  if (!prepared.subscriptionId || !prepared.providerSubscriptionId || !prepared.baselinePeriodEnd || !prepared.stateToken || !prepared.targetProviderVariantId) {
    throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_INTERNAL_ERROR", 500);
  }
  // Expected customer from the authoritative local subscription (the database checks it again).
  const expectedCustomerId = await repository.findProviderCustomerId(prepared.subscriptionId);
  if (!expectedCustomerId) throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_NOT_ELIGIBLE", 409);

  // Provider read outside any database transaction; a failed read sends nothing.
  const read = await provider.readSubscription(prepared.providerSubscriptionId);
  if (read.kind !== "snapshot") throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_PROVIDER_UNAVAILABLE", 503);
  const snapshot = read.snapshot;
  if (snapshot.paymentProcessor !== "stripe") {
    // PayPal (and anything not positively identified) cannot be changed through this API flow.
    throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_PAYMENT_METHOD_UNSUPPORTED", 409);
  }
  if (snapshot.providerSubscriptionId !== prepared.providerSubscriptionId
      || snapshot.providerCustomerId !== expectedCustomerId
      || snapshot.providerStoreId !== dependencies.storeId
      || snapshot.testMode !== (dependencies.environment === "test")
      || snapshot.providerStatus !== "active" || snapshot.providerCancelled
      || snapshot.providerPauseMode !== null || snapshot.providerTrialEndsAt !== null || snapshot.providerEndsAt !== null
      || !sameInstant(snapshot.providerRenewsAt, prepared.baselinePeriodEnd)) {
    throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_STATE_CHANGED", 409);
  }

  const checkedAt = dependencies.now().toISOString();
  let dispatch: { planChangeId: string; targetProviderVariantId: string };
  try {
    dispatch = await repository.request({
      salonId, actorProfileId: input.userId, targetPlanId, stateToken: prepared.stateToken,
      evidence: toProviderEvidence(snapshot), checkedAt, now: checkedAt,
    });
  } catch (error) {
    if (error instanceof PlanChangeDatabaseRejection) {
      if (error.code === "BILLING_PLAN_CHANGE_PENDING") return { outcome: "already_pending", change: await latestOrNull(repository, salonId) };
      throw rejection(error.code);
    }
    // The intent may or may not be committed. Without the returned id this call has no dispatch
    // right, so nothing is sent; a committed intent stays blocking and unresolved.
    return { outcome: "status_unknown", change: await latestOrNull(repository, salonId) };
  }
  if (dispatch.targetProviderVariantId !== prepared.targetProviderVariantId) {
    // The database-recorded target is authoritative; a mismatch means a bug, so nothing is sent.
    return { outcome: "status_unknown", change: await latestOrNull(repository, salonId) };
  }

  // The only dispatch: this call alone received the new intent id from the atomic request.
  let patched: Awaited<ReturnType<BillingPlanChangeProvider["patchVariant"]>>;
  try {
    patched = await provider.patchVariant(prepared.providerSubscriptionId, dispatch.targetProviderVariantId);
  } catch {
    // Any throw after the dispatch right was taken may follow a sent request: ambiguous.
    patched = { kind: "ambiguous" };
  }
  if (patched.kind === "accepted" && patched.snapshot.providerCustomerId !== expectedCustomerId) {
    // A response for another customer is not valid evidence for this change.
    patched = { kind: "ambiguous" };
  }
  const recordInput = {
    environment: dependencies.environment,
    planChangeId: dispatch.planChangeId,
    result: patched.kind,
    evidence: patched.kind === "accepted" ? toProviderEvidence(patched.snapshot) : null,
  } as const;
  // Recording the same result again is an idempotent database replay; the PATCH is never repeated.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await repository.record({ ...recordInput, now: dependencies.now().toISOString() });
      return { outcome: "requested", change: await latestOrNull(repository, salonId) };
    } catch {
      // fall through to one replay of the same result
    }
  }
  return { outcome: "status_unknown", change: await latestOrNull(repository, salonId) };
}

/** Owner status check: provider GET -> observed evidence -> evaluation. Never sends a PATCH. */
export async function refreshPlanChange(
  input: { userId: string },
  dependencies: PlanChangeDependencies,
): Promise<PlanChangeOutcome> {
  const { repository, provider } = dependencies;
  const salonId = await ownedSalon(repository, input.userId);
  const latest = await repository.latestChange(salonId);
  if (!latest) return { outcome: "none", change: null };
  if (!BLOCKING_PLAN_CHANGE_STATUSES.has(latest.status)) return { outcome: "current", change: latest, providerChecked: false };

  let providerChecked = false;
  const read = await provider.readSubscription(latest.providerSubscriptionId);
  if (read.kind === "snapshot" && read.snapshot.providerSubscriptionId === latest.providerSubscriptionId
      && read.snapshot.providerCustomerId === latest.providerCustomerId) {
    await repository.record({
      environment: dependencies.environment, planChangeId: latest.id, result: "observed",
      evidence: toProviderEvidence(read.snapshot), now: dependencies.now().toISOString(),
    });
    providerChecked = true;
  }
  await repository.evaluate({ environment: dependencies.environment, subscriptionId: latest.subscriptionId, now: dependencies.now().toISOString() });
  const current = await repository.latestChange(salonId);
  return current ? { outcome: "current", change: current, providerChecked } : { outcome: "none", change: null };
}

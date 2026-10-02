export type NormalizedLemonSqueezySubscription = {
  providerSubscriptionId: string;
  providerStoreId: string;
  providerCustomerId: string;
  providerOrderId: string | null;
  providerProductId: string;
  providerVariantId: string;
  providerStatus: string;
  providerCancelled: boolean;
  providerPauseMode: "free" | "void" | null;
  providerPauseResumesAt: string | null;
  providerTrialEndsAt: string | null;
  providerRenewsAt: string | null;
  providerEndsAt: string | null;
  providerCreatedAt: string;
  providerUpdatedAt: string;
  testMode: boolean;
};

export class LemonSqueezySubscriptionObjectError extends Error {
  constructor() { super("LEMONSQUEEZY_SUBSCRIPTION_OBJECT_INVALID"); this.name = "LemonSqueezySubscriptionObjectError"; }
}

function id(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) throw new LemonSqueezySubscriptionObjectError();
  return String(value);
}
function date(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) throw new LemonSqueezySubscriptionObjectError();
  return value;
}

export function normalizeLemonSqueezySubscriptionObject(payload: unknown): NormalizedLemonSqueezySubscription {
  if (!payload || typeof payload !== "object") throw new LemonSqueezySubscriptionObjectError();
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== "subscriptions") throw new LemonSqueezySubscriptionObjectError();
  const attributes = (data as { attributes?: unknown }).attributes;
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) throw new LemonSqueezySubscriptionObjectError();
  const a = attributes as Record<string, unknown>;
  const pause = a.pause;
  let pauseMode: "free" | "void" | null = null;
  let pauseResumesAt: string | null = null;
  if (pause !== null) {
    if (!pause || typeof pause !== "object" || Array.isArray(pause)) throw new LemonSqueezySubscriptionObjectError();
    const mode = (pause as Record<string, unknown>).mode;
    if (mode !== "free" && mode !== "void") throw new LemonSqueezySubscriptionObjectError();
    pauseMode = mode;
    pauseResumesAt = date((pause as Record<string, unknown>).resumes_at, true);
  }
  if (typeof a.status !== "string" || !a.status.trim() || typeof a.cancelled !== "boolean" || typeof a.test_mode !== "boolean") throw new LemonSqueezySubscriptionObjectError();
  const createdAt = date(a.created_at)!;
  const updatedAt = date(a.updated_at)!;
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new LemonSqueezySubscriptionObjectError();
  return {
    providerSubscriptionId: id((data as { id?: unknown }).id)!, providerStoreId: id(a.store_id)!,
    providerCustomerId: id(a.customer_id)!, providerOrderId: id(a.order_id, true), providerProductId: id(a.product_id)!,
    providerVariantId: id(a.variant_id)!, providerStatus: a.status, providerCancelled: a.cancelled,
    providerPauseMode: pauseMode, providerPauseResumesAt: pauseResumesAt,
    providerTrialEndsAt: date(a.trial_ends_at, true), providerRenewsAt: date(a.renews_at, true), providerEndsAt: date(a.ends_at, true),
    providerCreatedAt: createdAt, providerUpdatedAt: updatedAt, testMode: a.test_mode,
  };
}

import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type {
  BillingCheckoutCurrentState,
  BillingCheckoutIntentAcquisition,
  BillingCheckoutLedger,
} from "./billingCheckoutCore.ts";

type AcquireRow = {
  acquisition_outcome: unknown;
  checkout_session_id: unknown;
  idempotency_key: unknown;
  status: unknown;
  requested_plan_id: unknown;
  actor_profile_id: unknown;
  provider: unknown;
  environment: unknown;
  provider_session_id: unknown;
  expires_at: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECKOUT_STATUSES = new Set(["creating", "open", "completed", "expired", "failed", "cancelled"]);
const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function requiredUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("BILLING_CHECKOUT_INTENT_RESULT_INVALID");
  }
  return value;
}

function requiredTimestamp(value: unknown) {
  if (typeof value !== "string") throw new Error("BILLING_CHECKOUT_CURRENT_STATE_INVALID");
  const match = RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (!match) throw new Error("BILLING_CHECKOUT_CURRENT_STATE_INVALID");
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, offsetHourRaw, offsetMinuteRaw] = match;
  const year = Number(yearRaw), month = Number(monthRaw), day = Number(dayRaw);
  const hour = Number(hourRaw), minute = Number(minuteRaw), second = Number(secondRaw);
  const offsetHour = offsetHourRaw === undefined ? 0 : Number(offsetHourRaw);
  const offsetMinute = offsetMinuteRaw === undefined ? 0 : Number(offsetMinuteRaw);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 ||
      minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
      !Number.isFinite(Date.parse(value))) {
    throw new Error("BILLING_CHECKOUT_CURRENT_STATE_INVALID");
  }
  return value;
}

export function parseBillingCheckoutIntentAcquisition(
  value: unknown,
  trustedEnvironment: BillingEnvironment,
  trustedSalonId: string,
): BillingCheckoutIntentAcquisition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BILLING_CHECKOUT_INTENT_RESULT_INVALID");
  }
  const row = value as AcquireRow;
  if (
    (row.acquisition_outcome !== "created" && row.acquisition_outcome !== "existing") ||
    row.provider !== "lemonsqueezy" ||
    row.environment !== trustedEnvironment ||
    typeof row.status !== "string" ||
    !CHECKOUT_STATUSES.has(row.status) ||
    (row.provider_session_id !== null &&
      (typeof row.provider_session_id !== "string" || !UUID_PATTERN.test(row.provider_session_id))) ||
    (row.expires_at !== null &&
      (typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at))))
  ) {
    throw new Error("BILLING_CHECKOUT_INTENT_RESULT_INVALID");
  }
  if (
    (row.acquisition_outcome === "created" &&
      (row.status !== "creating" || row.provider_session_id !== null)) ||
    (row.acquisition_outcome === "existing" &&
      row.status !== "creating" && row.status !== "open")
  ) {
    throw new Error("BILLING_CHECKOUT_INTENT_RESULT_INVALID");
  }
  return {
    outcome: row.acquisition_outcome,
    provider: "lemonsqueezy",
    environment: trustedEnvironment,
    providerSessionId: row.provider_session_id,
    checkoutSession: {
      id: requiredUuid(row.checkout_session_id),
      salonId: trustedSalonId,
      actorProfileId: requiredUuid(row.actor_profile_id),
      requestedPlanId: requiredUuid(row.requested_plan_id),
      idempotencyKey: requiredUuid(row.idempotency_key),
      status: row.status as BillingCheckoutLedger["status"],
      expiresAt: row.expires_at,
    },
  };
}

export function parseBillingCheckoutCurrentState(
  value: unknown,
  trustedEnvironment: BillingEnvironment,
): BillingCheckoutCurrentState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BILLING_CHECKOUT_CURRENT_STATE_INVALID");
  }
  const row = value as Record<string, unknown>;
  const status = row.status;
  const providerSessionId = row.provider_session_id;
  const checkoutUrlHash = row.checkout_url_hash;
  const expiresAt = row.expires_at;
  if (
    row.provider !== "lemonsqueezy" ||
    row.environment !== trustedEnvironment ||
    typeof status !== "string" ||
    !CHECKOUT_STATUSES.has(status) ||
    (providerSessionId !== null &&
      (typeof providerSessionId !== "string" || !UUID_PATTERN.test(providerSessionId))) ||
    (checkoutUrlHash !== null &&
      (typeof checkoutUrlHash !== "string" || !/^[0-9a-f]{64}$/.test(checkoutUrlHash))) ||
    (expiresAt !== null &&
      (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))))
  ) {
    throw new Error("BILLING_CHECKOUT_CURRENT_STATE_INVALID");
  }
  try {
    return {
      id: requiredUuid(row.id),
      createdAt: requiredTimestamp(row.created_at),
      salonId: requiredUuid(row.salon_id),
      actorProfileId: requiredUuid(row.actor_profile_id),
      requestedPlanId: requiredUuid(row.requested_plan_id),
      idempotencyKey: requiredUuid(row.idempotency_key),
      status: status as BillingCheckoutCurrentState["status"],
      expiresAt,
      provider: "lemonsqueezy",
      environment: trustedEnvironment,
      providerSessionId,
      checkoutUrlHash,
    };
  } catch {
    throw new Error("BILLING_CHECKOUT_CURRENT_STATE_INVALID");
  }
}

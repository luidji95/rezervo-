import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type {
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

function requiredUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("BILLING_CHECKOUT_INTENT_RESULT_INVALID");
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

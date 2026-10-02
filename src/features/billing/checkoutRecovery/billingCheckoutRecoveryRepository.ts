import type { BillingEnvironment } from "../config/billingEnvironment.ts";

export type CheckoutRecoveryClaimOutcome =
  | "claimed"
  | "already_open"
  | "already_completed"
  | "already_claimed"
  | "manual_review";

export type CheckoutRecoveryClaim = {
  claimOutcome: CheckoutRecoveryClaimOutcome;
  recoveryAttemptId: string | null;
  claimToken: string | null;
  checkoutSessionId: string;
  ledgerStatus: string;
  provider: "lemonsqueezy";
  environment: BillingEnvironment;
  providerSessionId: string | null;
  requestedPlanId: string;
  salonId: string;
  idempotencyKey: string;
  ledgerCreatedAt: string;
  ledgerExpiresAt: string | null;
};

export type CheckoutRecoveryAuditOutcome =
  | "still_pending"
  | "provider_not_found"
  | "provider_unavailable"
  | "invalid_candidate"
  | "ambiguous"
  | "pagination_limit_reached"
  | "manual_review"
  | "configuration_error"
  | "invalid_provider_response";

export type CheckoutRecoveryCompletion = {
  completionOutcome: "completed" | "already_completed" | "claim_lost";
  status: string | null;
  outcome: string | null;
};

export type CheckoutRecoveryFinalizationOutcome =
  | "finalized"
  | "already_finalized"
  | "finalization_conflict"
  | "attempt_state_conflict"
  | "provider_id_conflict"
  | "provider_checkout_expired"
  | "ledger_state_conflict"
  | "claim_lost";

export type CheckoutRecoveryFinalization = {
  finalizationOutcome: CheckoutRecoveryFinalizationOutcome;
  recoveryAttemptId: string;
  ledgerStatus: string | null;
  attemptStatus: string | null;
  auditOutcome: string | null;
  attemptCompletedAt: string | null;
};

export type CheckoutRecoveryProviderMapping = {
  storeId: string;
  variantId: string;
  planCode: "starter" | "pro";
};

export interface BillingCheckoutRecoveryRepository {
  claimCheckoutRecovery(input: {
    checkoutSessionId: string;
    environment: BillingEnvironment;
    leaseSeconds: number;
  }): Promise<CheckoutRecoveryClaim>;
  completeCheckoutRecoveryAttempt(input: {
    recoveryAttemptId: string;
    claimToken: string;
    environment: BillingEnvironment;
    outcome: CheckoutRecoveryAuditOutcome;
  }): Promise<CheckoutRecoveryCompletion>;
  finalizeCheckoutRecovery(input: {
    recoveryAttemptId: string;
    claimToken: string;
    environment: BillingEnvironment;
    providerCheckoutId: string;
    checkoutUrlHash: string;
    providerExpiresAt: string;
  }): Promise<CheckoutRecoveryFinalization>;
  resolveTrustedProviderMapping(input: {
    requestedPlanId: string;
    environment: BillingEnvironment;
  }): Promise<CheckoutRecoveryProviderMapping | null>;
  listKnownProviderCheckoutIds(input: {
    checkoutSessionId: string;
    environment: BillingEnvironment;
  }): Promise<ReadonlySet<string>>;
}

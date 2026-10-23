// E1: read-only presentation of resolve_billing_resubscribe_eligibility_v1 for the billing overview.
// Acquisition (acquire_billing_checkout_intent_v3) stays authoritative and re-checks under locks.

export const RESUBSCRIBE_BLOCK_REASONS = [
  "not_owner",
  "terminal_state_unconfirmed",
  "plan_change_unresolved",
  "override_active",
  "purchase_activation_pending",
  "reconciliation_required",
  "unavailable",
] as const;

export type ResubscribeBlockReason = (typeof RESUBSCRIBE_BLOCK_REASONS)[number];

export type ResubscribeOverview =
  | { state: "not_applicable"; reason: null }
  | { state: "disabled"; reason: null }
  | { state: "eligible"; reason: null }
  | { state: "blocked"; reason: ResubscribeBlockReason };

export const NOT_APPLICABLE_RESUBSCRIBE: ResubscribeOverview = { state: "not_applicable", reason: null };

type Input = {
  isOwner: boolean;
  /** Raw local subscription row (never sent to the browser). */
  subscription: {
    status: string;
    billing_provider: string | null;
    provider_subscription_id: string | null;
    current_period_ends_at: string | null;
  } | null;
  /** Checkout capability, environment parity and the default-off resubscribe flag together. */
  enabled: boolean;
  now: Date;
};

type Dependencies = {
  /** Read-only database eligibility; no provider call and no mutation. */
  eligibility(): Promise<{ eligible: boolean; reason: string | null }>;
};

// Only states that end the previous paid period can become a resubscribe. A cancelled subscription
// whose period still runs is the existing resume/portal path; past_due is payment recovery.
function isCandidate(subscription: NonNullable<Input["subscription"]>, now: Date) {
  if (subscription.billing_provider === null || subscription.provider_subscription_id === null) return false;
  if (subscription.status === "expired") return true;
  if (subscription.status !== "cancelled") return false;
  const end = subscription.current_period_ends_at ? Date.parse(subscription.current_period_ends_at) : NaN;
  return !Number.isFinite(end) || end <= now.getTime();
}

export async function resolveResubscribeOverview(input: Input, dependencies: Dependencies): Promise<ResubscribeOverview> {
  if (!input.subscription || !isCandidate(input.subscription, input.now)) return NOT_APPLICABLE_RESUBSCRIBE;
  if (!input.isOwner) return { state: "blocked", reason: "not_owner" };
  if (!input.enabled) return { state: "disabled", reason: null };
  let result: { eligible: boolean; reason: string | null };
  try {
    result = await dependencies.eligibility();
  } catch {
    return { state: "blocked", reason: "unavailable" };
  }
  if (result.eligible === true && result.reason === null) return { state: "eligible", reason: null };
  const reason = RESUBSCRIBE_BLOCK_REASONS.find((candidate) => candidate === result.reason);
  return { state: "blocked", reason: reason ?? "unavailable" };
}

/** Validates the overview field; anything unexpected is treated as "not offered". */
export function parseResubscribeOverview(value: unknown): ResubscribeOverview {
  const candidate = value as { state?: unknown; reason?: unknown } | null;
  if (!candidate || typeof candidate !== "object") return NOT_APPLICABLE_RESUBSCRIBE;
  if (candidate.state === "eligible" || candidate.state === "disabled" || candidate.state === "not_applicable") {
    return candidate.reason === null ? { state: candidate.state, reason: null } : NOT_APPLICABLE_RESUBSCRIBE;
  }
  if (candidate.state === "blocked") {
    const reason = RESUBSCRIBE_BLOCK_REASONS.find((item) => item === candidate.reason);
    return reason ? { state: "blocked", reason } : NOT_APPLICABLE_RESUBSCRIBE;
  }
  return NOT_APPLICABLE_RESUBSCRIBE;
}

/** Owner-facing explanation; null when there is nothing to say. */
export function getResubscribeMessage(overview: ResubscribeOverview | undefined): string | null {
  if (!overview) return null;
  switch (overview.state) {
    case "eligible":
      return "Prethodna pretplata je istekla. Možete izabrati novi mesečni Starter ili Pro paket; podaci salona ostaju sačuvani, a novi probni period se ne dodeljuje. Pristup se vraća tek kada stigne potvrda aktivacije.";
    case "disabled":
      return "Ponovna online kupovina nakon isteka trenutno nije uključena. Za ponovno aktiviranje kontaktirajte podršku.";
    case "not_applicable":
      return null;
    case "blocked":
      switch (overview.reason) {
        case "not_owner":
          return "Novu pretplatu može da kupi samo vlasnik salona.";
        case "terminal_state_unconfirmed":
          return "Čekamo potvrdu da je prethodna pretplata istekla. Nova kupovina biće dostupna nakon potvrde.";
        case "plan_change_unresolved":
          return "Prethodna promena paketa još nije razrešena. Obratite se podršci pre nove kupovine.";
        case "override_active":
          return "Salon trenutno koristi poseban pristup, pa nova kupovina nije dostupna. Obratite se podršci.";
        case "purchase_activation_pending":
          return "Postoji kupovina koja čeka aktivaciju. Nemojte pokretati novu kupovinu; proverite status kasnije.";
        case "reconciliation_required":
        case "unavailable":
          return "Stanje prethodne pretplate je potrebno proveriti pre nove kupovine. Obratite se podršci.";
      }
  }
}

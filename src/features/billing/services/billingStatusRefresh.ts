import type { BillingOverview } from "../types/billingOverview.ts";
import type { SalonEntitlements } from "../types/entitlements.ts";

export type RefreshTrigger = "manual" | "return";
export type RefreshOutcome = "changed" | "unchanged" | "failed";

/** Minimum spacing for automatic (focus/visibility/pageshow) refreshes; manual checks are never throttled. */
export const AUTO_REFRESH_MIN_INTERVAL_MS = 30_000;

/** Fingerprint of the server-owned fields the billing view depends on. Never includes provider URLs or identifiers. */
export function billingStatusKey(entitlements: SalonEntitlements | null, overview: BillingOverview | null) {
  if (!entitlements || !overview) return null;
  return JSON.stringify([
    entitlements.planCode, entitlements.rawSubscriptionStatus, entitlements.accessSource, entitlements.accessMode,
    entitlements.accessReason, entitlements.accessEndsAt, entitlements.currentPeriodEndsAt, entitlements.trialEndsAt,
    entitlements.overrideType, entitlements.overrideEndsAt,
    overview.canOpenCustomerPortal, overview.portalUnavailableReason, overview.canStartCheckout,
  ]);
}

/** Outcome of a refresh: success is only ever derived from freshly read server data, never from a return event. */
export function resolveRefreshOutcome(before: string | null, after: { entitlements: SalonEntitlements | null; overview: BillingOverview | null }): RefreshOutcome {
  const next = billingStatusKey(after.entitlements, after.overview);
  if (next === null) return "failed";
  return next === before ? "unchanged" : "changed";
}

export function getRefreshMessage(outcome: RefreshOutcome) {
  switch (outcome) {
    case "changed":
      return "Stanje pretplate je ažurirano prema podacima iz Rezervo sistema.";
    case "unchanged":
      return "Stanje pretplate se nije promenilo. Ako ste upravo završili radnju kod payment providera, potvrda može stići uz kašnjenje; proverite ponovo za nekoliko minuta.";
    case "failed":
      return "Provera statusa nije uspela. Prikazani podaci mogu biti zastareli.";
  }
}

/** Single-flight gate with throttling for automatic triggers. No timers, so there is nothing to clean up. */
export function createRefreshGate(now: () => number = Date.now, minIntervalMs = AUTO_REFRESH_MIN_INTERVAL_MS) {
  let inFlight = false;
  let lastStartedAt = -Infinity;
  return {
    tryStart(trigger: RefreshTrigger) {
      if (inFlight) return false;
      if (trigger === "return" && now() - lastStartedAt < minIntervalMs) return false;
      inFlight = true;
      lastStartedAt = now();
      return true;
    },
    finish() { inFlight = false; },
  };
}

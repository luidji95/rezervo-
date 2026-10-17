import type { BillingOverview } from "../types/billingOverview.ts";
import type { SalonEntitlements } from "../types/entitlements.ts";

type EntitlementsView = Pick<SalonEntitlements, "accessSource" | "accessReason" | "rawSubscriptionStatus" | "currentPeriodEndsAt">;
type OverviewView = Pick<BillingOverview, "canOpenCustomerPortal" | "portalUnavailableReason" | "billingEnvironment">;

export type PortalPresentation =
  | { kind: "hidden" }
  | { kind: "note"; message: string }
  | { kind: "action"; title: string; description: string; cta: string };

export type SubscriptionStatusPresentation = {
  /** Status lines derived only from canonical entitlements; empty when nothing reliable can be said. */
  lines: string[];
  portal: PortalPresentation;
};

/** Formats an ISO timestamp with the product date convention; null for missing or invalid input. */
export function formatBillingDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  // sr-Latn-RS long dates already end with a period; callers add their own sentence punctuation.
  return new Intl.DateTimeFormat("sr-Latn-RS", { dateStyle: "long" }).format(new Date(time)).replace(/\.$/, "");
}

const HANDOFF = "Radnja se završava kod payment providera, van Rezervo aplikacije.";
const CONFIRMATION = "Stanje u Rezervu se menja tek kada stigne potvrda od providera; to može kratko potrajati.";

function portalDescription(overview: OverviewView) {
  const prefix = overview.billingEnvironment === "test" ? "Test okruženje. " : "";
  return `${prefix}Način plaćanja, podatke za račun i račune pregledate i ažurirate u portalu. ${HANDOFF}`;
}

function subscriptionLines(entitlements: EntitlementsView): string[] {
  const periodEnd = formatBillingDate(entitlements.currentPeriodEndsAt);
  switch (entitlements.accessReason) {
    case "active_period":
      return periodEnd ? ["Pretplata je aktivna.", `Sledeća obnova: ${periodEnd}.`] : ["Pretplata je aktivna."];
    case "cancelled_until_period_end":
      return periodEnd ? [`Pretplata je otkazana. Pristup imate do ${periodEnd}.`] : [];
    case "cancelled":
      return [periodEnd ? `Pretplata je otkazana. Pristup je trajao do ${periodEnd}.` : "Pretplata je otkazana i pristup je istekao."];
    case "past_due":
      return ["Poslednja naplata nije uspela. Nalog je trenutno u režimu samo za pregled; podaci ostaju sačuvani."];
    case "expired":
      return ["Pretplata je istekla. Nalog je u režimu samo za pregled; podaci ostaju sačuvani."];
    case "invalid_period":
      return ["Trenutno ne možemo da potvrdimo važenje pretplate. Pristup je privremeno ograničen na pregled. Proverite status ili kontaktirajte podršku."];
    case "period_expired":
      return ["Period pretplate je istekao. Nalog je u režimu samo za pregled."];
    default:
      return [];
  }
}

/** Billing state of the underlying subscription, shown apart from the access the override effectively grants. */
function overrideLines(entitlements: EntitlementsView): string[] {
  return entitlements.rawSubscriptionStatus === "past_due"
    ? ["Poslednja naplata pretplate nije uspela. Trenutni pristup salona određuje posebno odobrenje, a ne naplata."]
    : [];
}

function portalAction(entitlements: EntitlementsView, overview: OverviewView): PortalPresentation {
  if (entitlements.accessSource === "billing_override" && entitlements.rawSubscriptionStatus === "past_due") {
    return {
      kind: "action",
      title: "Ažuriranje načina plaćanja",
      description: `Ažurirajte način plaćanja pretplate. ${HANDOFF} Ovo ne menja pristup koji trenutno određuje posebno odobrenje.`,
      cta: "Ažuriraj način plaćanja",
    };
  }
  // Subscription-governed access: recovery is explained, but no promise is made about when access changes.
  if (entitlements.accessSource === "subscription" && entitlements.accessReason === "past_due") {
    return {
      kind: "action",
      title: "Ažuriranje načina plaćanja",
      description: `Ažurirajte način plaćanja kako bi se naplata mogla ponoviti. ${HANDOFF} ${CONFIRMATION}`,
      cta: "Ažuriraj način plaćanja",
    };
  }
  return { kind: "action", title: "Upravljanje pretplatom", description: portalDescription(overview), cta: "Upravljaj pretplatom" };
}

function portalUnavailable(entitlements: EntitlementsView, overview: OverviewView): PortalPresentation {
  if (overview.portalUnavailableReason === "not_owner") {
    return { kind: "note", message: "Pretplatom i načinom plaćanja upravlja vlasnik salona." };
  }
  if (overview.portalUnavailableReason === "unavailable") {
    const recovery = entitlements.accessSource === "subscription" && entitlements.accessReason === "past_due";
    return { kind: "note", message: `${recovery ? "Ažuriranje načina plaćanja" : "Upravljanje pretplatom"} trenutno nije dostupno. Podaci o pretplati ostaju dostupni za pregled; za pomoć kontaktirajte podršku.` };
  }
  return { kind: "hidden" };
}

export function getSubscriptionStatusPresentation(entitlements: EntitlementsView, overview: OverviewView | null): SubscriptionStatusPresentation {
  const lines = entitlements.accessSource === "subscription" ? subscriptionLines(entitlements) : overrideLines(entitlements);
  if (!overview) return { lines, portal: { kind: "hidden" } };
  return { lines, portal: overview.canOpenCustomerPortal ? portalAction(entitlements, overview) : portalUnavailable(entitlements, overview) };
}

import type { BillingPlanCatalogItem } from "../types/billingOverview.ts";
import type { PlanChangeOverview, PlanChangeState, PlanChangeUnavailableReason, PlanChangeView } from "../types/planChange.ts";
import { formatBillingDate } from "./billingSubscriptionPresentation.ts";
import { formatPlanPrice } from "./planCatalog.ts";

const PLAN_NAMES = { starter: "Starter", pro: "Pro" } as const;
const STATES = new Set<PlanChangeState>(["pending_confirmation", "scheduled", "review_required", "completed", "not_applied", "abandoned"]);
const REASONS = new Set<PlanChangeUnavailableReason>(["disabled", "not_owner", "not_applicable", "pending", "renewal_too_close", "employees_over_target", "payment_required", "cancelled", "override_active", "purchase_pending", "unavailable"]);
const NEXT_ACTIONS = new Set(["none", "check_status_later", "contact_support"]);

export const UNAVAILABLE_PLAN_CHANGE_OVERVIEW: PlanChangeOverview = {
  canRequest: false, unavailableReason: "unavailable", targetPlan: null, effectiveAt: null, canCheckStatus: false, current: null,
};

const target = (value: unknown) => (value === "starter" || value === "pro" ? value : null);
const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function parseView(value: unknown): PlanChangeView | null | undefined {
  if (value === null) return null;
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.id !== "string" || !STATES.has(v.state as PlanChangeState)
      || (v.direction !== "upgrade" && v.direction !== "downgrade") || !NEXT_ACTIONS.has(v.nextAction as string)
      || typeof v.effectiveAt !== "string" || (v.targetPlan !== null && target(v.targetPlan) === null)) return undefined;
  return {
    id: v.id, state: v.state as PlanChangeState, direction: v.direction, targetPlan: target(v.targetPlan),
    effectiveAt: v.effectiveAt, nextAction: v.nextAction as PlanChangeView["nextAction"],
  };
}

/** Validates the overview's planChange; anything malformed becomes "no action available". */
export function parsePlanChangeOverview(value: unknown): PlanChangeOverview {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.canRequest !== "boolean" || typeof v.canCheckStatus !== "boolean") return UNAVAILABLE_PLAN_CHANGE_OVERVIEW;
  const current = parseView(v.current);
  if (current === undefined) return UNAVAILABLE_PLAN_CHANGE_OVERVIEW;
  const reason = v.unavailableReason === null ? null : REASONS.has(v.unavailableReason as PlanChangeUnavailableReason) ? v.unavailableReason as PlanChangeUnavailableReason : undefined;
  if (reason === undefined || (v.canRequest && (reason !== null || target(v.targetPlan) === null || !validDate(v.effectiveAt)))) {
    return { ...UNAVAILABLE_PLAN_CHANGE_OVERVIEW, current };
  }
  return {
    canRequest: v.canRequest, unavailableReason: reason, targetPlan: target(v.targetPlan),
    effectiveAt: validDate(v.effectiveAt) ? v.effectiveAt : null, canCheckStatus: v.canCheckStatus, current,
  };
}

export type PlanChangeStatusPresentation = { tone: "info" | "warning" | "success" | "neutral"; message: string; detail: string | null };

/** Status of an existing change. Only a confirmed (scheduled) change states a switch date. */
export function getPlanChangeStatusPresentation(view: PlanChangeView): PlanChangeStatusPresentation {
  const name = view.targetPlan ? PLAN_NAMES[view.targetPlan] : "novi paket";
  const date = formatBillingDate(view.effectiveAt);
  switch (view.state) {
    case "scheduled":
      return {
        tone: "info",
        message: date ? `Prelazak na ${name} zakazan je za ${date}.` : `Prelazak na ${name} je zakazan za narednu obnovu.`,
        detail: view.direction === "upgrade"
          ? "Pro mogućnosti počinju tek nakon potvrđene uspešne obnove."
          : "Do tada ostaje Pro. Nova aktiviranja zaposlenih ograničena su na limit Starter paketa.",
      };
    case "pending_confirmation":
      return { tone: "warning", message: "Ishod promene još nije potvrđen. Nemojte ponavljati zahtev. Proverite status.", detail: null };
    case "review_required":
      return { tone: "warning", message: "Promenu je potrebno proveriti. Obratite se podršci.", detail: null };
    case "completed":
      return { tone: "success", message: `Prelazak na ${name} je potvrđen nakon uspešne obnove.`, detail: null };
    case "not_applied":
      return { tone: "neutral", message: "Promena paketa nije primenjena. Trenutni paket ostaje nepromenjen.", detail: null };
    case "abandoned":
      return { tone: "neutral", message: "Promena paketa nije sprovedena jer pretplata nije obnovljena.", detail: null };
  }
}

/** Explanation when a new change cannot be requested; null when nothing useful can be said. */
export function getPlanChangeUnavailableMessage(overview: PlanChangeOverview, input: { activeEmployees: number | null; plans: BillingPlanCatalogItem[] | null }): string | null {
  switch (overview.unavailableReason) {
    case "renewal_too_close": return "Promena paketa nije moguća u poslednjih 48 sati pre obnove. Pokušajte posle obnove.";
    case "employees_over_target": {
      const max = input.plans?.find((plan) => plan.code === overview.targetPlan)?.maxEmployees ?? null;
      return max === null
        ? "Za prelazak na manji paket prvo deaktivirajte višak aktivnih zaposlenih."
        : `Starter dozvoljava najviše ${max} aktivna zaposlena${input.activeEmployees === null ? "" : `, a trenutno ih je ${input.activeEmployees}`}. Prvo deaktivirajte višak zaposlenih, pa pokušajte ponovo.`;
    }
    case "payment_required": return "Promena paketa nije moguća dok postoji problem sa plaćanjem.";
    case "cancelled": return "Promena paketa nije moguća za otkazanu pretplatu.";
    case "purchase_pending": return "Promena paketa nije moguća dok kupovina čeka aktivaciju.";
    case "override_active": return "Promena paketa trenutno nije dostupna za ovaj salon.";
    case "unavailable": return "Promena paketa trenutno nije dostupna.";
    default: return null;
  }
}

export type PlanChangeConfirmation = { title: string; confirmLabel: string; lines: string[] };

/** Everything the owner must see before confirming. Price is the trusted catalog base monthly price. */
export function getPlanChangeConfirmation(input: {
  currentPlan: "starter" | "pro";
  targetPlan: "starter" | "pro";
  effectiveAt: string;
  plans: BillingPlanCatalogItem[] | null;
}): PlanChangeConfirmation | null {
  const date = formatBillingDate(input.effectiveAt);
  const catalog = input.plans?.find((plan) => plan.code === input.targetPlan);
  const price = catalog ? formatPlanPrice(catalog.monthlyPrice, catalog.currency) : null;
  if (!date || !catalog || !price || input.currentPlan === input.targetPlan) return null;
  const current = PLAN_NAMES[input.currentPlan];
  const next = PLAN_NAMES[input.targetPlan];
  const lines = [
    `Trenutni paket: ${current}.`,
    `Novi paket: ${next}, ${price} mesečno.`,
    `Promena važi od naredne obnove: ${date}.`,
    `Sada se ništa ne naplaćuje. ${current} ostaje do obnove, a nova cena se primenjuje pri obnovi.`,
    input.targetPlan === "pro"
      ? "Pro mogućnosti počinju tek nakon potvrđene uspešne obnove."
      : `Od zahteva nova aktiviranja zaposlenih ograničena su na ${catalog.maxEmployees ?? "limit Starter paketa"}; Starter važi nakon potvrđene uspešne obnove.`,
    `Ako obnova ne bude potvrđena, posle ${date} nalog prelazi u režim pregleda dok se plaćanje ne potvrdi.`,
    "Zahtev nije moguće samostalno poništiti ili zameniti.",
  ];
  return { title: `Promena na ${next}`, confirmLabel: `Potvrdi promenu na ${next}`, lines };
}

const REQUEST_ERRORS: Record<string, string> = {
  BILLING_PLAN_CHANGE_UNAUTHORIZED: "Prijavljena sesija nije dostupna. Prijavite se ponovo.",
  BILLING_PLAN_CHANGE_FORBIDDEN: "Samo vlasnik salona može da promeni paket.",
  BILLING_PLAN_CHANGE_DISABLED: "Promena paketa trenutno nije uključena.",
  BILLING_PLAN_CHANGE_REQUEST_INVALID: "Zahtev za promenu paketa nije ispravan.",
  BILLING_PLAN_CHANGE_NOT_ELIGIBLE: "Promena paketa trenutno nije moguća za ovu pretplatu.",
  BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE: "Promena paketa nije moguća u poslednjih 48 sati pre obnove.",
  BILLING_PLAN_CHANGE_EMPLOYEES_OVER_TARGET: "Prvo deaktivirajte višak aktivnih zaposlenih za izabrani paket.",
  BILLING_PLAN_CHANGE_PAYMENT_REQUIRED: "Promena paketa nije moguća dok postoji problem sa plaćanjem.",
  BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED: "Promena paketa nije moguća za otkazanu pretplatu.",
  BILLING_PLAN_CHANGE_PURCHASE_PENDING: "Promena paketa nije moguća dok kupovina čeka aktivaciju.",
  BILLING_PLAN_CHANGE_PAYMENT_METHOD_UNSUPPORTED: "Za ovaj način plaćanja promena paketa nije moguća kroz Rezervo. Obratite se podršci.",
  BILLING_PLAN_CHANGE_STATE_CHANGED: "Stanje pretplate se u međuvremenu promenilo. Promena nije poslata; proverite prikazane podatke.",
  BILLING_PLAN_CHANGE_PROVIDER_UNAVAILABLE: "Pretplatu trenutno nije moguće proveriti. Promena nije poslata; pokušajte kasnije.",
};

/**
 * Error codes that are returned only before any provider mutation (nothing was sent). Any other
 * failure (network, lost response, 5xx without such a code) is treated as an unknown outcome.
 */
export function getPlanChangeRequestErrorMessage(code: unknown): string | null {
  return typeof code === "string" ? REQUEST_ERRORS[code] ?? null : null;
}

export const PLAN_CHANGE_UNKNOWN_MESSAGE = "Ishod promene još nije potvrđen. Nemojte ponavljati zahtev. Proverite status.";
export const PLAN_CHANGE_CHECK_FAILED_MESSAGE = "Provera promene nije uspela. Prikazani podaci mogu biti zastareli.";
export const PLAN_CHANGE_CHECKED_MESSAGE = "Stanje promene je provereno prema podacima iz Rezervo sistema.";

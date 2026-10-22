import assert from "node:assert/strict";
import test from "node:test";

import {
  UNAVAILABLE_PLAN_CHANGE_OVERVIEW,
  getPlanChangeConfirmation,
  getPlanChangeRequestErrorMessage,
  getPlanChangeStatusPresentation,
  getPlanChangeUnavailableMessage,
  parsePlanChangeOverview,
} from "./billingPlanChangePresentation.ts";
import { getPendingPlanChangeNotice } from "./billingCapacityPresentation.ts";
import { billingStatusKey } from "./billingStatusRefresh.ts";
import type { BillingOverview, BillingPlanCatalogItem } from "../types/billingOverview.ts";
import type { PlanChangeView } from "../types/planChange.ts";
import type { SalonEntitlements } from "../types/entitlements.ts";

const plans: BillingPlanCatalogItem[] = [
  { code: "starter", name: "Starter", monthlyPrice: 2990, yearlyPrice: null, currency: "RSD", maxEmployees: 3, isAvailable: true },
  { code: "pro", name: "Pro", monthlyPrice: 5990, yearlyPrice: null, currency: "RSD", maxEmployees: 10, isAvailable: true },
];
const view = (overrides: Partial<PlanChangeView> = {}): PlanChangeView => ({ id: "c1", state: "scheduled", direction: "upgrade", targetPlan: "pro", effectiveAt: "2027-03-31T00:00:00.000Z", nextAction: "none", ...overrides });

test("overview parsing is strict; malformed data never enables an action", () => {
  const valid = { canRequest: true, unavailableReason: null, targetPlan: "pro", effectiveAt: "2027-03-31T00:00:00.000Z", canCheckStatus: false, current: null };
  assert.deepEqual(parsePlanChangeOverview(valid), valid);
  for (const bad of [null, undefined, {}, { ...valid, targetPlan: "premium" }, { ...valid, effectiveAt: "x" }, { ...valid, effectiveAt: null }, { ...valid, unavailableReason: "mystery" }, { ...valid, canRequest: "yes" }]) {
    assert.equal(parsePlanChangeOverview(bad).canRequest, false, JSON.stringify(bad));
  }
  // a malformed current change does not invent one; a valid current stays visible even if the rest is off
  assert.deepEqual(parsePlanChangeOverview({ ...valid, current: { id: "c1", state: "done" } }), UNAVAILABLE_PLAN_CHANGE_OVERVIEW);
  const kept = parsePlanChangeOverview({ ...valid, canRequest: false, unavailableReason: "disabled", targetPlan: null, effectiveAt: null, current: view() });
  assert.equal(kept.current?.state, "scheduled");
  assert.equal(kept.unavailableReason, "disabled");
});

test("only a confirmed (scheduled) change states the switch date; unknown and review never invite a repeat", () => {
  assert.match(getPlanChangeStatusPresentation(view()).message, /^Prelazak na Pro zakazan je za .*2027\.?$/);
  assert.equal(getPlanChangeStatusPresentation(view()).detail, "Pro mogućnosti počinju tek nakon potvrđene uspešne obnove.");
  assert.match(getPlanChangeStatusPresentation(view({ direction: "downgrade", targetPlan: "starter" })).detail ?? "", /Do tada ostaje Pro/);
  assert.equal(getPlanChangeStatusPresentation(view({ effectiveAt: "not-a-date" })).message, "Prelazak na Pro je zakazan za narednu obnovu.");
  assert.equal(getPlanChangeStatusPresentation(view({ state: "pending_confirmation" })).message, "Ishod promene još nije potvrđen. Nemojte ponavljati zahtev. Proverite status.");
  assert.equal(getPlanChangeStatusPresentation(view({ state: "review_required" })).message, "Promenu je potrebno proveriti. Obratite se podršci.");
  assert.match(getPlanChangeStatusPresentation(view({ state: "completed" })).message, /potvrđen nakon uspešne obnove/);
  for (const state of ["pending_confirmation", "review_required", "not_applied", "abandoned"] as const) {
    const text = JSON.stringify(getPlanChangeStatusPresentation(view({ state })));
    assert.doesNotMatch(text, /zakazan je za|Plaćanje uspešno|Pokušaj(te)? ponovo/i, state);
  }
});

test("confirmation shows current/new plan, catalog price, date, no charge now, no cancellation, Pro after renewal", () => {
  const upgrade = getPlanChangeConfirmation({ currentPlan: "starter", targetPlan: "pro", effectiveAt: "2027-03-31T00:00:00.000Z", plans })!;
  const text = upgrade.lines.join(" ");
  for (const expected of [/Trenutni paket: Starter/, /Novi paket: Pro, 5\.990 RSD mesečno/, /naredne obnove: .*2027/, /Sada se ništa ne naplaćuje/, /Starter ostaje do obnove/, /Pro mogućnosti počinju tek nakon potvrđene uspešne obnove/, /nije moguće samostalno poništiti ili zameniti/, /režim pregleda/]) {
    assert.match(text, expected);
  }
  const downgrade = getPlanChangeConfirmation({ currentPlan: "pro", targetPlan: "starter", effectiveAt: "2027-03-31T00:00:00.000Z", plans })!;
  assert.match(downgrade.lines.join(" "), /ograničena su na 3/);
  assert.equal(getPlanChangeConfirmation({ currentPlan: "starter", targetPlan: "pro", effectiveAt: "bad", plans }), null);
  assert.equal(getPlanChangeConfirmation({ currentPlan: "starter", targetPlan: "pro", effectiveAt: "2027-03-31T00:00:00.000Z", plans: [] }), null);
  assert.equal(getPlanChangeConfirmation({ currentPlan: "pro", targetPlan: "pro", effectiveAt: "2027-03-31T00:00:00.000Z", plans }), null);
});

test("unavailable explanations, employee surplus guidance and pre-dispatch error codes", () => {
  const overview = { ...UNAVAILABLE_PLAN_CHANGE_OVERVIEW, unavailableReason: "employees_over_target" as const, targetPlan: "starter" as const };
  assert.match(getPlanChangeUnavailableMessage(overview, { activeEmployees: 5, plans }) ?? "", /najviše 3 aktivna zaposlena, a trenutno ih je 5/);
  assert.match(getPlanChangeUnavailableMessage({ ...overview, unavailableReason: "renewal_too_close" }, { activeEmployees: 1, plans }) ?? "", /48 sati/);
  assert.equal(getPlanChangeUnavailableMessage({ ...overview, unavailableReason: "disabled" }, { activeEmployees: 1, plans }), null);
  assert.equal(getPlanChangeUnavailableMessage({ ...overview, unavailableReason: "not_applicable" }, { activeEmployees: 1, plans }), null);
  assert.match(getPlanChangeRequestErrorMessage("BILLING_PLAN_CHANGE_PROVIDER_UNAVAILABLE") ?? "", /Promena nije poslata/);
  assert.equal(getPlanChangeRequestErrorMessage("BILLING_PLAN_CHANGE_INTERNAL_ERROR"), null, "unknown outcome, not a safe error");
  assert.equal(getPlanChangeRequestErrorMessage(undefined), null);
});

test("pending downgrade capacity notice and refresh fingerprint include the plan-change state", () => {
  const entitlements = { planCapabilities: { maxEmployees: 10 }, employeeCapacity: { maxEmployees: 3, planMaxEmployees: 10, reason: "pending_plan_change", pendingPlanCode: "starter" }, purchaseActivation: null } as unknown as SalonEntitlements;
  assert.match(getPendingPlanChangeNotice(entitlements) ?? "", /Starter ograničava broj aktivnih zaposlenih na 3/);
  assert.equal(getPendingPlanChangeNotice({ ...entitlements, employeeCapacity: { maxEmployees: 3, planMaxEmployees: 3, reason: "plan", pendingPlanCode: null } }), null);
  const base = { canOpenCustomerPortal: false, portalUnavailableReason: "not_applicable", canStartCheckout: false, billingEnvironment: "test", plans, usage: { activeEmployees: 1 } } as const;
  const ent = { planCode: "starter" } as unknown as SalonEntitlements;
  const a = billingStatusKey(ent, { ...base, planChange: { ...UNAVAILABLE_PLAN_CHANGE_OVERVIEW, current: view({ state: "pending_confirmation" }) } } as BillingOverview);
  const b = billingStatusKey(ent, { ...base, planChange: { ...UNAVAILABLE_PLAN_CHANGE_OVERVIEW, current: view() } } as BillingOverview);
  assert.notEqual(a, b);
});

import assert from "node:assert/strict";
import test from "node:test";
import { billingStatusKey, createRefreshGate, getRefreshMessage, resolveRefreshOutcome } from "./billingStatusRefresh.ts";
import type { BillingOverview } from "../types/billingOverview.ts";
import type { SalonEntitlements } from "../types/entitlements.ts";

const entitlements = (patch: Partial<SalonEntitlements> = {}) => ({
  planCode: "pro", rawSubscriptionStatus: "past_due", accessSource: "subscription", accessMode: "read_only", accessReason: "past_due",
  accessEndsAt: null, currentPeriodEndsAt: "2026-12-15T10:00:00Z", trialEndsAt: null, overrideType: null, overrideEndsAt: null, ...patch,
}) as SalonEntitlements;
const overview = (patch: Partial<BillingOverview> = {}) => ({
  billingEnvironment: "live", usage: { activeEmployees: 1 }, plans: [], canOpenCustomerPortal: true, portalUnavailableReason: null, canStartCheckout: false, ...patch,
}) as BillingOverview;

test("unchanged server state is reported as unchanged, never as success", () => {
  const before = billingStatusKey(entitlements(), overview());
  const outcome = resolveRefreshOutcome(before, { entitlements: entitlements(), overview: overview() });
  assert.equal(outcome, "unchanged");
  assert.doesNotMatch(getRefreshMessage(outcome), /uspešn|nastavljen|aktivirana/i);
});

test("authoritative active/cancelled transitions are reported as changed", () => {
  const before = billingStatusKey(entitlements(), overview());
  const recovered = entitlements({ rawSubscriptionStatus: "active", accessMode: "full", accessReason: "active_period" });
  assert.equal(resolveRefreshOutcome(before, { entitlements: recovered, overview: overview() }), "changed");
  const cancelled = entitlements({ rawSubscriptionStatus: "cancelled", accessMode: "full", accessReason: "cancelled_until_period_end" });
  assert.equal(resolveRefreshOutcome(billingStatusKey(recovered, overview()), { entitlements: cancelled, overview: overview() }), "changed");
  assert.equal(resolveRefreshOutcome(before, { entitlements: entitlements(), overview: overview({ canOpenCustomerPortal: false, portalUnavailableReason: "unavailable" }) }), "changed");
});

test("a failed or partial refresh is failed, not unchanged", () => {
  const before = billingStatusKey(entitlements(), overview());
  assert.equal(resolveRefreshOutcome(before, { entitlements: null, overview: overview() }), "failed");
  assert.equal(resolveRefreshOutcome(before, { entitlements: entitlements(), overview: null }), "failed");
  assert.match(getRefreshMessage("failed"), /zastareli/);
});

test("status key carries no provider identifiers or URLs", () => {
  const key = billingStatusKey(entitlements(), { ...overview(), portalUrl: "https://signed.example/secret" } as BillingOverview);
  assert.doesNotMatch(key ?? "", /signed|secret|https/);
});

test("gate: single flight, manual never throttled, return events throttled, no timers", () => {
  let clock = 1_000_000;
  const gate = createRefreshGate(() => clock, 30_000);
  assert.equal(gate.tryStart("return"), true);
  assert.equal(gate.tryStart("manual"), false, "second request while in flight is rejected");
  assert.equal(gate.tryStart("return"), false);
  gate.finish();
  clock += 1_000;
  assert.equal(gate.tryStart("return"), false, "throttled inside window");
  assert.equal(gate.tryStart("manual"), true, "manual check bypasses the throttle");
  gate.finish();
  clock += 30_000;
  assert.equal(gate.tryStart("return"), true);
});

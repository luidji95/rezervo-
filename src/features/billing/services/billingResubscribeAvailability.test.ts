import assert from "node:assert/strict";
import test from "node:test";
import {
  getResubscribeMessage,
  parseResubscribeOverview,
  resolveResubscribeOverview,
} from "./billingResubscribeAvailability.ts";

const now = new Date("2026-10-23T12:00:00Z");
const expired = { status: "expired", billing_provider: "lemonsqueezy", provider_subscription_id: "1", current_period_ends_at: "2026-10-01T00:00:00Z" };

function deps(result: { eligible: boolean; reason: string | null } | Error) {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      eligibility: async () => {
        calls.push("eligibility");
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

test("only provider-linked ended subscriptions are candidates; nothing else reads the database", async () => {
  for (const subscription of [
    null,
    { ...expired, billing_provider: null, provider_subscription_id: null }, // trial/legacy/pilot: E2
    { ...expired, status: "active" },
    { ...expired, status: "trialing" },
    { ...expired, status: "past_due" }, // payment recovery
    { ...expired, status: "cancelled", current_period_ends_at: "2026-11-01T00:00:00Z" }, // resume path
  ]) {
    const { calls, dependencies } = deps({ eligible: true, reason: null });
    assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription, enabled: true, now }, dependencies), { state: "not_applicable", reason: null });
    assert.deepEqual(calls, []);
  }
});

test("flag/config off, non-owner and database answers", async () => {
  let d = deps({ eligible: true, reason: null });
  assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription: expired, enabled: false, now }, d.dependencies), { state: "disabled", reason: null });
  assert.deepEqual(d.calls, []);
  d = deps({ eligible: true, reason: null });
  assert.deepEqual(await resolveResubscribeOverview({ isOwner: false, subscription: expired, enabled: true, now }, d.dependencies), { state: "blocked", reason: "not_owner" });
  assert.deepEqual(d.calls, []);
  d = deps({ eligible: true, reason: null });
  assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription: expired, enabled: true, now }, d.dependencies), { state: "eligible", reason: null });
  const cancelledPast = { ...expired, status: "cancelled", current_period_ends_at: "2026-10-22T00:00:00Z" };
  d = deps({ eligible: false, reason: "terminal_state_unconfirmed" });
  assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription: cancelledPast, enabled: true, now }, d.dependencies), { state: "blocked", reason: "terminal_state_unconfirmed" });
  for (const reason of ["plan_change_unresolved", "override_active", "purchase_activation_pending", "reconciliation_required"]) {
    d = deps({ eligible: false, reason });
    assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription: expired, enabled: true, now }, d.dependencies), { state: "blocked", reason });
  }
  // unknown reason, inconsistent answer and errors fail closed
  for (const result of [{ eligible: false, reason: "something_new" }, { eligible: true, reason: "override_active" }, new Error("db")]) {
    d = deps(result);
    assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription: expired, enabled: true, now }, d.dependencies), { state: "blocked", reason: result instanceof Error || result.reason === "something_new" ? "unavailable" : "override_active" });
  }
});

test("parser accepts only canonical shapes", () => {
  assert.deepEqual(parseResubscribeOverview({ state: "eligible", reason: null }), { state: "eligible", reason: null });
  assert.deepEqual(parseResubscribeOverview({ state: "blocked", reason: "override_active" }), { state: "blocked", reason: "override_active" });
  for (const value of [undefined, null, "eligible", { state: "eligible", reason: "x" }, { state: "blocked", reason: "secret" }, { state: "open" }]) {
    assert.deepEqual(parseResubscribeOverview(value), { state: "not_applicable", reason: null });
  }
});

test("messages never promise access before activation and never claim a trial", () => {
  const eligible = getResubscribeMessage({ state: "eligible", reason: null })!;
  assert.match(eligible, /novi probni period se ne dodeljuje/);
  assert.match(eligible, /tek kada stigne potvrda/);
  assert.equal(getResubscribeMessage({ state: "not_applicable", reason: null }), null);
  assert.equal(getResubscribeMessage(undefined), null);
  for (const reason of ["not_owner", "terminal_state_unconfirmed", "plan_change_unresolved", "override_active", "purchase_activation_pending", "reconciliation_required", "unavailable"] as const) {
    assert.ok(getResubscribeMessage({ state: "blocked", reason }));
  }
});

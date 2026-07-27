import assert from "node:assert/strict";
import test from "node:test";

import {
  canResolveSalonEntitlements,
  resolveSubscriptionAccess,
  type SubscriptionAccessPlan,
  type SubscriptionAccessRecord,
} from "./subscriptionAccess.ts";

const now = new Date("2026-07-27T12:00:00.000Z");
const future = "2026-08-27T12:00:00.000Z";
const past = "2026-06-27T12:00:00.000Z";

const pro: SubscriptionAccessPlan = {
  code: "pro",
  name: "Pro",
  isActive: true,
  canUseStatistics: true,
  canUseAiReceptionist: false,
  canUseWhatsApp: false,
  canUseInstagram: false,
  canUseMarketing: false,
  canUseSmsReminders: true,
  maxEmployees: 10,
  maxMonthlyBookings: null,
  maxAiMessages: 0,
  maxMonthlyReminders: null,
};

const premium: SubscriptionAccessPlan = {
  ...pro,
  code: "premium",
  name: "Premium",
  isActive: false,
  canUseAiReceptionist: true,
  canUseWhatsApp: true,
  canUseInstagram: true,
  canUseMarketing: true,
  maxEmployees: 25,
  maxAiMessages: 5000,
};

function subscription(
  status: string,
  trialEndsAt: string | null = null,
  currentPeriodEndsAt: string | null = null,
): SubscriptionAccessRecord {
  return { status, trialEndsAt, currentPeriodEndsAt };
}

function resolve(record: SubscriptionAccessRecord | null, plan: SubscriptionAccessPlan | null = pro) {
  return resolveSubscriptionAccess({ subscription: record, plan, now });
}

test("trialing with a future end has full access", () => {
  const result = resolve(subscription("trialing", future));
  assert.equal(result.accessMode, "full");
  assert.equal(result.accessReason, "active_trial");
  assert.equal(result.effectiveCapabilities.canUseStatistics, true);
  assert.equal(result.effectiveCapabilities.canUseSmsReminders, true);
});

test("trial boundary and expired trial use strict greater-than access", () => {
  for (const end of [now.toISOString(), past]) {
    const result = resolve(subscription("trialing", end));
    assert.equal(result.accessMode, "read_only");
    assert.equal(result.accessReason, "trial_expired");
  }
});

test("trial without an end is invalid and read-only", () => {
  const result = resolve(subscription("trialing", null));
  assert.equal(result.accessMode, "read_only");
  assert.equal(result.accessReason, "invalid_trial_period");
});

test("active period lifecycle covers future, boundary and past", () => {
  const active = resolve(subscription("active", null, future));
  assert.equal(active.accessMode, "full");
  assert.equal(active.accessReason, "active_period");
  for (const end of [now.toISOString(), past]) {
    const ended = resolve(subscription("active", null, end));
    assert.equal(ended.accessMode, "read_only");
    assert.equal(ended.accessReason, "period_expired");
  }
});

test("active without period receives temporary legacy compatibility", () => {
  const result = resolve(subscription("active"));
  assert.equal(result.accessMode, "full");
  assert.equal(result.accessReason, "legacy_active_no_period");
  assert.equal(result.isLegacyActive, true);
  assert.equal(result.requiresBillingMigration, true);
});

test("cancelled subscription remains full only until a future period end", () => {
  const valid = resolve(subscription("cancelled", null, future));
  assert.equal(valid.accessMode, "full");
  assert.equal(valid.accessReason, "cancelled_until_period_end");
  for (const end of [past, null]) {
    const stopped = resolve(subscription("cancelled", null, end));
    assert.equal(stopped.accessMode, "read_only");
    assert.equal(stopped.accessReason, "cancelled");
  }
});

test("past_due and expired are read-only", () => {
  for (const status of ["past_due", "expired"]) {
    const result = resolve(subscription(status, future, future));
    assert.equal(result.accessMode, "read_only");
    assert.equal(result.accessReason, status);
  }
});

test("missing subscription and missing plan fail closed with distinct reasons", () => {
  const missingSubscription = resolve(null, null);
  assert.equal(missingSubscription.accessReason, "subscription_missing");
  assert.equal(missingSubscription.planCode, null);
  assert.equal(missingSubscription.hasActiveAccess, false);

  const missingPlan = resolve(subscription("active", null, future), null);
  assert.equal(missingPlan.accessReason, "plan_missing");
  assert.equal(missingPlan.hasActiveAccess, false);
});

test("inactive plan offering does not revoke an existing valid subscription", () => {
  const result = resolveSubscriptionAccess({
    subscription: subscription("active", null, future),
    plan: premium,
    now,
  });
  assert.equal(result.accessMode, "full");
  assert.equal(result.effectiveCapabilities.canUseAiReceptionist, true);
});

test("read-only Pro retains plan capabilities but disables effective operations", () => {
  const result = resolve(subscription("expired"));
  assert.equal(result.planCapabilities.canUseStatistics, true);
  assert.equal(result.planCapabilities.canUseSmsReminders, true);
  assert.equal(result.planCapabilities.maxEmployees, 10);
  assert.deepEqual(result.effectiveCapabilities, {
    canUseStatistics: false,
    canUseAiReceptionist: false,
    canUseWhatsApp: false,
    canUseInstagram: false,
    canUseMarketing: false,
    canUseSmsReminders: false,
    canCreateEmployees: false,
    canCreateAppointments: false,
    canUsePublicBooking: false,
    canManageBusinessData: false,
  });
  assert.equal(result.canUseStatistics, false);
  assert.equal(result.maxEmployees, 10);
});

test("server contract authorization rejects unrelated salon access", () => {
  assert.equal(canResolveSalonEntitlements({ authenticatedUserId: "user-a", ownerId: "user-a", hasActiveMembership: false }), true);
  assert.equal(canResolveSalonEntitlements({ authenticatedUserId: "manager-a", ownerId: "owner-a", hasActiveMembership: true }), true);
  assert.equal(canResolveSalonEntitlements({ authenticatedUserId: "user-b", ownerId: "owner-a", hasActiveMembership: false }), false);
});

test("final JSON contract exposes raw, plan and effective state together", () => {
  const result = resolve(subscription("trialing", future));
  const json = JSON.parse(JSON.stringify(result));
  assert.equal(json.rawSubscriptionStatus, "trialing");
  assert.equal(json.accessReason, "active_trial");
  assert.equal(json.planCapabilities.canUseStatistics, true);
  assert.equal(json.effectiveCapabilities.canUseStatistics, true);
  assert.equal(json.requiresBillingMigration, false);
});

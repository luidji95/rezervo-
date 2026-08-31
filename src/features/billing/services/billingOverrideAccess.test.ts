import assert from "node:assert/strict";
import test from "node:test";

import { resolveSubscriptionAccess, type SubscriptionAccessPlan } from "./subscriptionAccess.ts";
import { resolveBillingOverrideState, resolveEffectiveAccess } from "./billingOverrideAccess.ts";

const now = new Date("2026-07-27T12:00:00.000Z");
const future = "2026-08-27T12:00:00.000Z";
const past = "2026-06-27T12:00:00.000Z";

const starter: SubscriptionAccessPlan = {
  code: "starter", name: "Starter", isActive: true,
  canUseStatistics: false, canUseAiReceptionist: false, canUseWhatsApp: false,
  canUseInstagram: false, canUseMarketing: false, canUseSmsReminders: false,
  maxEmployees: 3, maxMonthlyBookings: null, maxAiMessages: 0, maxMonthlyReminders: 0,
};
const pro: SubscriptionAccessPlan = {
  ...starter, code: "pro", name: "Pro", canUseStatistics: true,
  canUseSmsReminders: true, maxEmployees: 10, maxMonthlyReminders: null,
};
const premium: SubscriptionAccessPlan = {
  ...pro, code: "premium", name: "Premium", isActive: false,
  canUseAiReceptionist: true, canUseWhatsApp: true, canUseInstagram: true,
  canUseMarketing: true, maxEmployees: 25, maxAiMessages: 5000,
};

function subscriptionAccess(status = "expired", plan: SubscriptionAccessPlan | null = starter) {
  return resolveSubscriptionAccess({
    subscription: {
      status, trialEndsAt: status === "trialing" ? future : null, currentPeriodEndsAt: null,
      billingProvider: "lemonsqueezy", billingEnvironment: "test",
      providerCustomerId: "customer-1", providerSubscriptionId: "subscription-1",
    },
    plan,
    trustedEnvironment: "test",
    now,
  });
}

function override(overrides: Partial<{ enabled: boolean; startsAt: string; endsAt: string | null }> = {}) {
  return {
    enabled: overrides.enabled ?? true,
    overrideType: "internal" as const,
    startsAt: overrides.startsAt ?? past,
    endsAt: overrides.endsAt ?? null,
  };
}

test("no override preserves active trial subscription access", () => {
  const base = subscriptionAccess("trialing", pro);
  assert.equal(resolveEffectiveAccess({ subscriptionAccess: base, billingOverride: null, overridePlan: null, trustedEnvironment: "test", now }), base);
});

test("active internal Pro override supersedes expired Starter subscription", () => {
  const result = resolveEffectiveAccess({ subscriptionAccess: subscriptionAccess(), billingOverride: override(), overridePlan: pro, trustedEnvironment: "test", now });
  assert.equal(result.accessSource, "billing_override");
  assert.equal(result.accessReason, "billing_override");
  assert.equal(result.planCode, "pro");
  assert.equal(result.subscriptionPlanCode, "starter");
  assert.equal(result.hasActiveAccess, true);
  assert.equal(result.effectiveCapabilities.canUseStatistics, true);
});

test("inactive Premium catalogue plan remains valid for explicit override", () => {
  const result = resolveEffectiveAccess({ subscriptionAccess: subscriptionAccess(), billingOverride: override(), overridePlan: premium, trustedEnvironment: "test", now });
  assert.equal(result.effectivePlanCode, "premium");
  assert.equal(result.effectiveCapabilities.canUseAiReceptionist, true);
});

test("disabled, scheduled and expired overrides fall back to subscription", () => {
  const base = subscriptionAccess();
  const cases = [
    override({ enabled: false }),
    override({ startsAt: future }),
    override({ endsAt: now.toISOString() }),
    override({ endsAt: past }),
  ];
  for (const candidate of cases) {
    const result = resolveEffectiveAccess({ subscriptionAccess: base, billingOverride: candidate, overridePlan: pro, trustedEnvironment: "test", now });
    assert.equal(result.accessMode, "read_only");
    assert.equal(result.accessSource, "subscription");
  }
  assert.equal(resolveBillingOverrideState({ billingOverride: cases[1], overridePlan: pro, now }), "scheduled");
  assert.equal(resolveBillingOverrideState({ billingOverride: cases[2], overridePlan: pro, now }), "expired");
});

test("future override end grants full access through but not at the boundary", () => {
  const active = resolveEffectiveAccess({ subscriptionAccess: subscriptionAccess(), billingOverride: override({ endsAt: future }), overridePlan: pro, trustedEnvironment: "test", now });
  assert.equal(active.accessMode, "full");
  assert.equal(active.overrideEndsAt, future);
  const boundary = resolveBillingOverrideState({ billingOverride: override({ endsAt: now.toISOString() }), overridePlan: pro, now });
  assert.equal(boundary, "expired");
});

test("active override works without an underlying subscription and preserves raw status when present", () => {
  const missing = resolveSubscriptionAccess({ subscription: null, plan: null, trustedEnvironment: "test", now });
  const granted = resolveEffectiveAccess({ subscriptionAccess: missing, billingOverride: override(), overridePlan: pro, trustedEnvironment: "test", now });
  assert.equal(granted.accessMode, "full");
  assert.equal(granted.rawSubscriptionStatus, null);
  assert.equal(granted.subscriptionPlanCode, null);

  const expired = resolveEffectiveAccess({ subscriptionAccess: subscriptionAccess("expired", starter), billingOverride: override(), overridePlan: pro, trustedEnvironment: "test", now });
  assert.equal(expired.rawSubscriptionStatus, "expired");
});

test("override capabilities come from override plan and clear legacy migration marker", () => {
  const legacy = subscriptionAccess("active", starter);
  assert.equal(legacy.requiresBillingMigration, true);
  const result = resolveEffectiveAccess({ subscriptionAccess: legacy, billingOverride: override(), overridePlan: pro, trustedEnvironment: "test", now });
  assert.equal(result.planCapabilities.maxEmployees, 10);
  assert.equal(result.canUseStatistics, true);
  assert.equal(result.requiresBillingMigration, false);
  assert.equal(result.isBillingExempt, true);
});

test("legacy active remains compatible when no override exists", () => {
  const legacy = subscriptionAccess("active", pro);
  const result = resolveEffectiveAccess({ subscriptionAccess: legacy, billingOverride: null, overridePlan: null, trustedEnvironment: "test", now });
  assert.equal(result.accessReason, "legacy_active_no_period");
  assert.equal(result.requiresBillingMigration, true);
});

test("active override with missing plan fails closed", () => {
  const result = resolveEffectiveAccess({ subscriptionAccess: subscriptionAccess("trialing", pro), billingOverride: override(), overridePlan: null, trustedEnvironment: "test", now });
  assert.equal(result.accessMode, "read_only");
  assert.equal(result.accessReason, "plan_missing");
  assert.equal(result.effectiveCapabilities.canUseStatistics, false);
});

test("browser-facing contract cannot contain internal reason or creator attribution", () => {
  const result = resolveEffectiveAccess({ subscriptionAccess: subscriptionAccess(), billingOverride: override(), overridePlan: pro, trustedEnvironment: "test", now });
  const json = JSON.parse(JSON.stringify(result));
  assert.equal("reason" in json, false);
  assert.equal("created_by_profile_id" in json, false);
  assert.equal(json.overrideType, "internal");
});

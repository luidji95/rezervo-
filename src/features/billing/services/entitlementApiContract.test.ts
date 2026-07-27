import assert from "node:assert/strict";
import test from "node:test";

import { buildEntitlementApiSuccess, getEntitlementApiErrorStatus } from "./entitlementApiContract.ts";
import { resolveEffectiveAccess } from "./billingOverrideAccess.ts";
import { resolveSubscriptionAccess } from "./subscriptionAccess.ts";

const now = new Date("2026-07-27T12:00:00Z");
const plan = {
  code: "pro" as const, name: "Pro", isActive: true,
  canUseStatistics: true, canUseAiReceptionist: false, canUseWhatsApp: false,
  canUseInstagram: false, canUseMarketing: false, canUseSmsReminders: true,
  maxEmployees: 10, maxMonthlyBookings: null, maxAiMessages: 0, maxMonthlyReminders: null,
};

test("entitlement API success serializes active override without internal audit fields", () => {
  const subscriptionAccess = resolveSubscriptionAccess({
    subscription: { status: "expired", trialEndsAt: null, currentPeriodEndsAt: null },
    plan,
    now,
  });
  const entitlements = resolveEffectiveAccess({
    subscriptionAccess,
    billingOverride: { enabled: true, overrideType: "pilot", startsAt: "2026-07-01T00:00:00Z", endsAt: null },
    overridePlan: plan,
    now,
  });
  const payload = JSON.parse(JSON.stringify(buildEntitlementApiSuccess(entitlements)));
  assert.equal(payload.success, true);
  assert.equal(payload.entitlements.accessSource, "billing_override");
  assert.equal(payload.entitlements.overrideType, "pilot");
  assert.equal("reason" in payload.entitlements, false);
  assert.equal("created_by_profile_id" in payload.entitlements, false);
});

test("unauthorized salon access maps to a non-leaking forbidden contract", () => {
  assert.equal(getEntitlementApiErrorStatus("FORBIDDEN"), 403);
  assert.equal(getEntitlementApiErrorStatus("ENTITLEMENTS_LOAD_FAILED"), 500);
});

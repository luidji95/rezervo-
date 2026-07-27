import assert from "node:assert/strict";
import test from "node:test";

import { resolveSubscriptionAccess } from "./subscriptionAccess.ts";
import { resolveEffectiveAccess } from "./billingOverrideAccess.ts";
import { getBillingAccessPresentation } from "./billingAccessPresentation.ts";

const now = new Date("2026-07-27T12:00:00.000Z");
const plan = {
  code: "pro" as const, name: "Pro", isActive: true,
  canUseStatistics: true, canUseAiReceptionist: false, canUseWhatsApp: false,
  canUseInstagram: false, canUseMarketing: false, canUseSmsReminders: true,
  maxEmployees: 10, maxMonthlyBookings: null, maxAiMessages: 0, maxMonthlyReminders: null,
};
const base = resolveSubscriptionAccess({ subscription: { status: "expired", trialEndsAt: null, currentPeriodEndsAt: null }, plan, now });

for (const [overrideType, expected] of [["internal", "Interni nalog"], ["pilot", "Pilot pristup"]] as const) {
  test(`${overrideType} override has billing-safe presentation`, () => {
    const entitlements = resolveEffectiveAccess({
      subscriptionAccess: base,
      billingOverride: { enabled: true, overrideType, startsAt: "2026-07-01T00:00:00Z", endsAt: "2026-08-01T00:00:00Z" },
      overridePlan: plan,
      now,
    });
    const presentation = getBillingAccessPresentation(entitlements);
    assert.equal(presentation.statusLabel, expected);
    assert.equal(presentation.paymentMessage, "Naplata nije potrebna.");
    assert.equal(presentation.billingActionsEnabled, false);
    assert.equal(presentation.accessEndsAt, "2026-08-01T00:00:00Z");
  });
}

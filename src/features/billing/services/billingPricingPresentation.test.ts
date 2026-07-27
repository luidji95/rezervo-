import assert from "node:assert/strict";
import test from "node:test";

import { remainingTrialDays } from "./billingPricingPresentation.ts";
import { PLAN_PRESENTATIONS } from "../data/planPresentation.ts";
import { UPGRADE_DESTINATION } from "../upgradeNavigation.ts";

const now = Date.parse("2026-07-27T12:00:00.000Z");

test("trial days use ceiling for a started day and never become negative", () => {
  assert.equal(remainingTrialDays("2026-07-28T12:00:00.000Z", now), 1);
  assert.equal(remainingTrialDays("2026-07-27T12:00:01.000Z", now), 1);
  assert.equal(remainingTrialDays("2026-07-27T11:59:59.000Z", now), 0);
  assert.equal(remainingTrialDays("invalid", now), 0);
});

test("billing presentation keeps Premium coming soon and exposes no checkout action", () => {
  const premium = PLAN_PRESENTATIONS.find((plan) => plan.code === "premium");
  assert.equal(premium?.comingSoon, true);
  assert.ok(premium?.features.filter((feature) => feature.availability === "coming_soon").length);
  assert.equal(PLAN_PRESENTATIONS.some((plan) => plan.features.some((feature) => /stripe|checkout|godišnj/i.test(feature.label))), false);
  assert.equal(UPGRADE_DESTINATION, "/settings?tab=billing");
});

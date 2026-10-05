import assert from "node:assert/strict";
import test from "node:test";
import { canOfferNewCheckout } from "./billingCheckoutEligibility.ts";
import { getCheckoutButtonPresentation } from "./billingCheckoutPresentation.ts";

const base = {
  isOwner: true, configured: true, databaseEnvironmentMatches: true, isBillingExempt: false, hasCompletedCheckout: false,
  subscription: { status: "trialing", billing_provider: null, billing_environment: null, provider_customer_id: null, provider_subscription_id: null, trial_starts_at: "2026-01-01T00:00:00Z", trial_ends_at: "2026-02-01T00:00:00Z", planCode: "pro" },
};
test("provider-free valid Pro trial, including ended trial, can choose a plan", () => {
  assert.equal(canOfferNewCheckout(base), true);
});
test("server/DB mismatch or unavailable attestation blocks even a provider-free trial", () => {
  assert.equal(canOfferNewCheckout({ ...base, databaseEnvironmentMatches: false }), false);
});
test("provider-linked subscriptions cannot open new checkout in any lifecycle state", () => {
  for (const status of ["active", "trialing", "past_due", "cancelled", "expired"]) {
    const eligible = canOfferNewCheckout({ ...base, subscription: { ...base.subscription, status, billing_provider: "lemonsqueezy", provider_subscription_id: "123" } });
    assert.equal(eligible, false);
    assert.equal(getCheckoutButtonPresentation({ planCode: "starter", currentPlanCode: "pro", accessReason: "expired", isBillingExempt: false, checkoutEnabled: true, checkoutEligible: eligible, loadingPlan: null }).disabled, true);
  }
});
test("missing subscription, invalid trial, override, completed checkout and unavailable configuration fail closed", () => {
  for (const input of [{ ...base, subscription: null }, { ...base, configured: false }, { ...base, isOwner: false }, { ...base, isBillingExempt: true }, { ...base, hasCompletedCheckout: true }, { ...base, subscription: { ...base.subscription, trial_starts_at: null } }, { ...base, subscription: { ...base.subscription, status: "expired" } }]) assert.equal(canOfferNewCheckout(input), false);
});
test("unknown checkout eligibility cannot enable CTA", () => {
  assert.equal(getCheckoutButtonPresentation({ planCode: "starter", currentPlanCode: null, accessReason: "subscription_missing", isBillingExempt: false, checkoutEnabled: true, loadingPlan: null }).disabled, true);
});

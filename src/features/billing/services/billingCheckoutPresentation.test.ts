import assert from "node:assert/strict";
import test from "node:test";

import { getCheckoutButtonPresentation } from "./billingCheckoutPresentation.ts";

const base = {
  currentPlanCode: "pro" as const,
  accessReason: "active_trial" as const,
  isBillingExempt: false,
  checkoutEnabled: true,
  loadingPlan: null,
};

test("disabled feature flag preserves inactive checkout buttons", () => {
  const result = getCheckoutButtonPresentation({
    ...base,
    planCode: "starter",
    checkoutEnabled: false,
  });
  assert.equal(result.disabled, true);
  assert.equal(result.checkoutPlan, null);
});

test("active Pro trial can activate Pro or choose Starter", () => {
  const pro = getCheckoutButtonPresentation({ ...base, planCode: "pro" });
  const starter = getCheckoutButtonPresentation({
    ...base,
    planCode: "starter",
  });
  assert.deepEqual(pro, {
    disabled: false,
    label: "Aktiviraj Pro",
    checkoutPlan: "pro",
  });
  assert.deepEqual(starter, {
    disabled: false,
    label: "Izaberi Starter",
    checkoutPlan: "starter",
  });
});

test("Premium and billing-exempt salons cannot start checkout", () => {
  const premium = getCheckoutButtonPresentation({
    ...base,
    planCode: "premium",
  });
  const exempt = getCheckoutButtonPresentation({
    ...base,
    planCode: "starter",
    isBillingExempt: true,
  });
  assert.equal(premium.disabled, true);
  assert.equal(premium.label, "Premium je u pripremi");
  assert.equal(exempt.disabled, true);
  assert.equal(exempt.label, "Checkout nije dostupan");
});

test("paid subscriptions cannot change or repurchase plans", () => {
  const current = getCheckoutButtonPresentation({
    ...base,
    planCode: "pro",
    accessReason: "active_period",
  });
  const other = getCheckoutButtonPresentation({
    ...base,
    planCode: "starter",
    accessReason: "active_period",
  });
  assert.equal(current.label, "Trenutni paket");
  assert.equal(other.label, "Promena paketa uskoro");
  assert.equal(current.disabled, true);
  assert.equal(other.disabled, true);
});

test("loading one plan disables every checkout action", () => {
  const loading = { ...base, loadingPlan: "pro" as const };
  const pro = getCheckoutButtonPresentation({ ...loading, planCode: "pro" });
  const starter = getCheckoutButtonPresentation({
    ...loading,
    planCode: "starter",
  });
  assert.equal(pro.label, "Otvaranje checkouta…");
  assert.equal(pro.disabled, true);
  assert.equal(starter.disabled, true);
  assert.equal(pro.checkoutPlan, null);
  assert.equal(starter.checkoutPlan, null);
});

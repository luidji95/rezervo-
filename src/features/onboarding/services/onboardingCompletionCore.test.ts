import assert from "node:assert/strict";
import test from "node:test";
import { completeOnboardingAndNavigate } from "./onboardingCompletionCore.ts";

test("refreshes authoritative salon state before exactly one navigation", async () => {
  const order: string[] = [];
  const saved = await completeOnboardingAndNavigate({
    save: async () => { order.push("save"); return { id: "salon-id" }; },
    onSaved: () => order.push("local-save"),
    refreshAuthorization: async () => { order.push("refresh"); return { currentSalon: { onboarding_completed: true } }; },
    navigate: () => order.push("navigate"),
  });
  assert.equal(saved.id, "salon-id");
  assert.deepEqual(order, ["save", "local-save", "refresh", "navigate"]);
});

test("does not navigate when authoritative refresh fails", async () => {
  let redirects = 0;
  await assert.rejects(() => completeOnboardingAndNavigate({
    save: async () => ({ id: "salon-id" }),
    refreshAuthorization: async () => ({ currentSalon: null }),
    navigate: () => { redirects += 1; },
  }), /ONBOARDING_STATE_NOT_REFRESHED/);
  assert.equal(redirects, 0);
});

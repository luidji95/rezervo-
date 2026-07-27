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

test("preserves the RPC trial end value and never fabricates local trial success", async () => {
  const rpcResult = { id: "salon-id", trial_ends_at: "2026-08-10T12:00:00.000Z", was_created: true };
  const saved = await completeOnboardingAndNavigate({
    save: async () => rpcResult,
    refreshAuthorization: async () => ({ currentSalon: { onboarding_completed: true } }),
    navigate: () => undefined,
  });
  assert.equal(saved, rpcResult);
  assert.equal(saved.trial_ends_at, rpcResult.trial_ends_at);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseBillingOverviewBody } from "./billingOverviewResponse.ts";

const valid = { success: true, usage: { activeEmployees: 2 }, plans: [], canOpenCustomerPortal: true, portalUnavailableReason: null, canStartCheckout: false, billingEnvironment: "live" };

test("accepts a complete canonical overview, including null environment", () => {
  assert.equal(parseBillingOverviewBody(valid)?.billingEnvironment, "live");
  const closed = parseBillingOverviewBody({ ...valid, canOpenCustomerPortal: false, portalUnavailableReason: "not_owner", billingEnvironment: null });
  assert.equal(closed?.portalUnavailableReason, "not_owner");
});

test("resubscribe availability is parsed and never guessed", () => {
  assert.deepEqual(parseBillingOverviewBody(valid)?.resubscribe, { state: "not_applicable", reason: null });
  assert.deepEqual(parseBillingOverviewBody({ ...valid, resubscribe: { state: "eligible", reason: null } })?.resubscribe, { state: "eligible", reason: null });
  assert.deepEqual(parseBillingOverviewBody({ ...valid, resubscribe: { state: "blocked", reason: "provider_id_123" } })?.resubscribe, { state: "not_applicable", reason: null });
});

test("rejects partial, inconsistent or unknown responses instead of guessing", () => {
  for (const body of [
    null, { ...valid, success: false }, { ...valid, usage: undefined }, { ...valid, billingEnvironment: "staging" },
    { ...valid, canOpenCustomerPortal: true, portalUnavailableReason: "unavailable" },
    { ...valid, canOpenCustomerPortal: false, portalUnavailableReason: null },
    { ...valid, canOpenCustomerPortal: false, portalUnavailableReason: "secret_flag_off" },
    { ...valid, canStartCheckout: "yes" },
  ]) assert.equal(parseBillingOverviewBody(body), null);
});

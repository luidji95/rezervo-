import assert from "node:assert/strict";
import test from "node:test";
import { parseBillingEnvironment } from "../config/billingEnvironment.ts";
import { resolveSubscriptionAccess } from "./subscriptionAccess.ts";
import { getEntitlementActionState } from "./entitlementLoadState.ts";
import { loadEntitlements, classifyEntitlementLoadFailure } from "./loadEntitlements.ts";
import { getEntitlementApiErrorStatus } from "./entitlementApiContract.ts";
import { resolveEffectiveAccess } from "./billingOverrideAccess.ts";
import { logEntitlementReadFailures, billingEnvironmentFailure } from "./entitlementDiagnostics.ts";

const active = resolveSubscriptionAccess({
  subscription: { status: "active", trialEndsAt: null, currentPeriodEndsAt: "2027-01-01T00:00:00Z", billingProvider: "lemonsqueezy", billingEnvironment: "test", providerCustomerId: "1", providerSubscriptionId: "2" },
  plan: { code: "starter", name: "Starter", isActive: true, canUseStatistics: false, canUseAiReceptionist: false, canUseWhatsApp: false, canUseInstagram: false, canUseMarketing: false, canUseSmsReminders: false, maxEmployees: 3, maxMonthlyBookings: null, maxAiMessages: 0, maxMonthlyReminders: 0 },
  trustedEnvironment: "test", now: new Date("2026-10-05T00:00:00Z"),
});

test("fetch failure diagnostics emit only a safe category, never raw error or request data", async () => {
  const cases = [
    [new TypeError("Illegal invocation"), "illegal_invocation"],
    [new TypeError("Invalid character in header content Authorization secret-token"), "invalid_headers"],
    [new TypeError("Cannot convert argument to a ByteString"), "invalid_headers"],
    [new TypeError("Failed to fetch https://example.invalid/?private=value"), "network_failure"],
    [new Error("secret-token"), "unknown"],
    [null, "unknown"],
  ] as const;
  for (const [error, expected] of cases) assert.equal(classifyEntitlementLoadFailure(error), expected);
  const logs: unknown[][] = [];
  const original = console.info;
  console.info = (...args) => { logs.push(args); };
  try {
    await loadEntitlements({ salonId: "private-salon", getAccessToken: async () => "private-token", request: async () => { throw new TypeError("Failed to fetch https://example.invalid/?private=value"); } });
  } finally { console.info = original; }
  assert.deepEqual(logs.at(-1), ["ENTITLEMENTS_LOAD", { stage: "failed", category: "network_failure" }]);
  assert.doesNotMatch(JSON.stringify(logs), /private|Authorization|headers|https:/);
});

test("Starter subscription with Pro override uses the effective Pro capacity in both fields", () => {
  for (const maxEmployees of [10, null]) {
    const result = resolveEffectiveAccess({
      subscriptionAccess: active,
      billingOverride: { enabled: true, overrideType: "pilot", startsAt: "2026-01-01T00:00:00Z", endsAt: null },
      overridePlan: { ...active.planCapabilities, code: "pro", name: "Pro", isActive: true, maxEmployees },
      trustedEnvironment: "test", now: new Date("2026-10-05T00:00:00Z"),
    });
    assert.equal(result.subscriptionPlanCode, "starter");
    assert.equal(result.effectivePlanCode, "pro");
    assert.equal(result.maxEmployees, maxEmployees);
    assert.equal(result.planCapabilities.maxEmployees, result.maxEmployees);
    const state = { entitlements: result, loading: false, error: null };
    assert.equal(getEntitlementActionState(state, 3).canCreateEmployee, true);
    assert.equal(getEntitlementActionState(state, 10).canCreateEmployee, maxEmployees === null);
  }
  assert.equal(active.maxEmployees, active.planCapabilities.maxEmployees);
});

test("diagnostics record both failures separately and discard all unsafe error fields", () => {
  const events: unknown[] = [];
  const log = (event: string, fields: unknown) => { events.push({ event, fields }); };
  logEntitlementReadFailures([
    { stage: "salon_read", error: { code: "42501", message: "secret", details: "payload", hint: "token" } },
    { stage: "membership_read", error: { code: "PGRST116" } },
    { stage: "subscription_read", error: { code: "42P01" } },
    { stage: "override_read", error: { code: "42501\nsecret" } },
  ], log);
  assert.deepEqual(events, [
    { event: "ENTITLEMENTS_NOT_CONFIGURED", fields: { stage: "salon_read", dbCode: "42501" } },
    { event: "ENTITLEMENTS_NOT_CONFIGURED", fields: { stage: "membership_read", dbCode: "PGRST116" } },
    { event: "ENTITLEMENTS_NOT_CONFIGURED", fields: { stage: "subscription_read", dbCode: "42P01" } },
    { event: "ENTITLEMENTS_NOT_CONFIGURED", fields: { stage: "override_read", dbCode: "UNKNOWN" } },
  ]);
  for (const code of [null, 42501, "", "42501 ", "42501\n", "token-secret", "PGRST1234"]) {
    let fields;
    logEntitlementReadFailures([{ stage: "subscription_read", error: { code } }], (_, value) => { fields = value; });
    assert.deepEqual(fields, { stage: "subscription_read", dbCode: "UNKNOWN" });
  }
  assert.deepEqual(billingEnvironmentFailure(undefined), { stage: "billing_environment_invalid", reason: "missing" });
  assert.deepEqual(billingEnvironmentFailure("private-value"), { stage: "billing_environment_invalid", reason: "invalid" });
});

test("billing environment accepts exact test/live only and configuration errors are not forbidden access", () => {
  assert.equal(parseBillingEnvironment("test"), "test");
  assert.equal(parseBillingEnvironment("live"), "live");
  for (const value of [undefined, "", "production", "TEST", "test "]) assert.throws(() => parseBillingEnvironment(value));
  assert.equal(getEntitlementApiErrorStatus("ENTITLEMENTS_NOT_CONFIGURED"), 500);
});

test("configuration failure does not become a successful read-only entitlement", async () => {
  const result = await loadEntitlements({ salonId: "salon", getAccessToken: async () => "test-token", request: async () => Response.json({ success: false, code: "ENTITLEMENTS_NOT_CONFIGURED" }, { status: 500 }) });
  assert.equal(result.error, "ENTITLEMENTS_NOT_CONFIGURED");
  assert.deepEqual(getEntitlementActionState({ ...result, loading: false }), { ready: false, loadFailed: true, readOnly: false, canManage: false, canCreateEmployee: false });
});

test("network, session and malformed response failures fail closed; retry can restore access", async () => {
  for (const request of [async () => { throw new Error("network"); }, async () => new Response("invalid json"), async () => Response.json({ success: true })]) {
    const result = await loadEntitlements({ salonId: "salon", getAccessToken: async () => "test-token", request });
    assert.equal(result.entitlements, null);
    assert.ok(result.error);
  }
  const authFailure = await loadEntitlements({ salonId: "salon", getAccessToken: async () => { throw new Error("session failed"); }, request: fetch });
  assert.equal(authFailure.entitlements, null);
  const retry = await loadEntitlements({ salonId: "salon", getAccessToken: async () => "test-token", request: async () => Response.json({ success: true, entitlements: active }) });
  assert.equal(getEntitlementActionState({ ...retry, loading: false }).canCreateEmployee, true);
});

test("Starter employee actions allow below limit and block at/above limit", () => {
  const state = { entitlements: active, loading: false, error: null };
  for (const count of [0, 1, 2]) assert.equal(getEntitlementActionState(state, count).canCreateEmployee, true);
  for (const count of [3, 4]) assert.equal(getEntitlementActionState(state, count).canCreateEmployee, false);
  assert.equal(getEntitlementActionState(state, 3).canManage, true);
});

test("stale active data never permits writes during loading/error; valid inactive state remains distinct", () => {
  for (const state of [{ entitlements: active, loading: true, error: null }, { entitlements: active, loading: false, error: "ENTITLEMENTS_NOT_CONFIGURED" }]) {
    assert.equal(getEntitlementActionState(state).canCreateEmployee, false);
    assert.equal(getEntitlementActionState(state).canManage, false);
    assert.equal(getEntitlementActionState(state).readOnly, false);
  }
  const inactive = resolveSubscriptionAccess({ subscription: null, plan: null, trustedEnvironment: "test", now: new Date() });
  const result = getEntitlementActionState({ entitlements: inactive, loading: false, error: null });
  assert.equal(result.readOnly, true);
  assert.equal(result.loadFailed, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { resolvePlanChangeOverview } from "./billingPlanChangeAvailability.ts";
import type { BillingPlanChangeRepository, PlanChangePrepareRow, PlanChangeRecord } from "./billingPlanChangeCore.ts";

const NOW = new Date("2027-03-01T00:00:00.000Z");
const config = { provider: "lemonsqueezy" as const, environment: "test" as const, apiKey: "k", storeId: "501229" };
const eligible: PlanChangePrepareRow = { outcome: "eligible", errorCode: null, subscriptionId: "sub", providerSubscriptionId: "1", baselinePeriodEnd: "2027-03-31T00:00:00.000Z", targetProviderVariantId: "2", stateToken: "secret-token" };
const record = (status: PlanChangeRecord["status"], baselinePeriodEnd = "2027-03-31T00:00:00.000Z"): PlanChangeRecord => ({
  id: "change-1", subscriptionId: "sub", providerSubscriptionId: "2618348", providerCustomerId: "8001", status,
  direction: "upgrade", targetPlan: "pro", baselinePeriodEnd, conflictCode: "plan_change_variant_unexpected",
});

function setup(options: { latest?: PlanChangeRecord | null; prepare?: PlanChangePrepareRow; config?: typeof config | null; parity?: boolean; latestThrows?: boolean } = {}) {
  const calls: string[] = [];
  const repository: BillingPlanChangeRepository = {
    findOwnedSalon: async () => { throw new Error("not used"); },
    findActivePlanId: async (slug) => { calls.push(`plan:${slug}`); return `plan-${slug}`; },
    findProviderCustomerId: async () => { throw new Error("not used"); },
    prepare: async () => { calls.push("prepare"); return options.prepare ?? eligible; },
    request: async () => { throw new Error("overview must never request"); },
    record: async () => { throw new Error("overview must never record"); },
    evaluate: async () => { throw new Error("overview must never evaluate"); },
    latestChange: async () => { calls.push("latest"); if (options.latestThrows) throw new Error("db"); return options.latest ?? null; },
  };
  const dependencies = {
    getConfig: () => (options.config === undefined ? config : options.config),
    environmentMatches: async () => options.parity ?? true,
    repository,
  };
  return { dependencies, calls };
}
const input = (overrides: Partial<Parameters<typeof resolvePlanChangeOverview>[0]> = {}) => ({ userId: "owner", salonId: "salon", isOwner: true, currentPlanCode: "starter", now: NOW, ...overrides });

test("eligible owner gets the single opposite target and the effective date; read-only calls only", async () => {
  for (const [current, target] of [["starter", "pro"], ["pro", "starter"]] as const) {
    const { dependencies, calls } = setup();
    const result = await resolvePlanChangeOverview(input({ currentPlanCode: current }), dependencies);
    assert.deepEqual(result, { canRequest: true, unavailableReason: null, targetPlan: target, effectiveAt: "2027-03-31T00:00:00.000Z", canCheckStatus: false, current: null });
    assert.deepEqual(calls, ["latest", `plan:${target}`, "prepare"]);
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  }
});

test("disabled flag/config or parity failure: no action, but an existing change stays visible", async () => {
  for (const options of [{ config: null }, { parity: false }]) {
    const { dependencies, calls } = setup({ ...options, latest: record("unknown") });
    const result = await resolvePlanChangeOverview(input(), dependencies);
    assert.equal(result.canRequest, false);
    assert.equal(result.unavailableReason, "disabled");
    assert.equal(result.canCheckStatus, false);
    assert.equal(result.current?.state, "pending_confirmation");
    assert.equal(calls.includes("prepare"), false);
  }
});

test("non-owner (manager) sees the status read-only and cannot act", async () => {
  const { dependencies, calls } = setup({ latest: record("confirmed") });
  const result = await resolvePlanChangeOverview(input({ isOwner: false }), dependencies);
  assert.deepEqual([result.canRequest, result.unavailableReason, result.canCheckStatus, result.current?.state], [false, "not_owner", false, "scheduled"]);
  assert.equal(calls.includes("prepare"), false);
});

test("an unresolved change blocks new requests and offers the explicit status check", async () => {
  for (const status of ["requested", "unknown", "confirmed", "manual_review"] as const) {
    const { dependencies, calls } = setup({ latest: record(status) });
    const result = await resolvePlanChangeOverview(input(), dependencies);
    assert.deepEqual([result.canRequest, result.unavailableReason, result.canCheckStatus], [false, "pending", true]);
    assert.equal(calls.includes("prepare"), false);
    assert.equal(JSON.stringify(result).includes("plan_change_variant_unexpected"), false, "conflict codes are not exposed");
  }
});

test("database refusals map to stable reasons (48 h, capacity, trial/pilot, override, cancelled, past due)", async () => {
  for (const [code, reason, keepsTarget] of [
    ["BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE", "renewal_too_close", false],
    ["EMPLOYEE_OVER_TARGET_LIMIT", "employees_over_target", true],
    ["BILLING_PLAN_CHANGE_SUBSCRIPTION_UNSUPPORTED", "not_applicable", false],
    ["BILLING_PLAN_CHANGE_OVERRIDE_ACTIVE", "override_active", false],
    ["BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED", "cancelled", false],
    ["BILLING_SUBSCRIPTION_PAYMENT_REQUIRED", "payment_required", false],
    ["BILLING_PURCHASE_ACTIVATION_PENDING", "purchase_pending", false],
    ["BILLING_PLAN_CHANGE_MAPPING_INVALID", "unavailable", false],
    ["SOMETHING_NEW", "not_applicable", false],
  ] as const) {
    const { dependencies } = setup({ currentPlanCode: "pro", prepare: { ...eligible, outcome: "rejected", errorCode: code } } as never);
    const result = await resolvePlanChangeOverview(input({ currentPlanCode: "pro" }), dependencies);
    assert.deepEqual([result.canRequest, result.unavailableReason, result.targetPlan], [false, reason, keepsTarget ? "starter" : null], code);
  }
});

test("trial/expired plans without a Starter/Pro subscription plan, invalid dates and read failures are not requestable", async () => {
  const premium = setup();
  assert.equal((await resolvePlanChangeOverview(input({ currentPlanCode: "premium" }), premium.dependencies)).unavailableReason, "not_applicable");
  const none = setup();
  assert.equal((await resolvePlanChangeOverview(input({ currentPlanCode: null }), none.dependencies)).unavailableReason, "not_applicable");
  const badDate = setup({ prepare: { ...eligible, baselinePeriodEnd: "not-a-date" } });
  assert.equal((await resolvePlanChangeOverview(input(), badDate.dependencies)).canRequest, false);
  const broken = setup({ latestThrows: true });
  assert.deepEqual(await resolvePlanChangeOverview(input(), broken.dependencies), { canRequest: false, unavailableReason: "unavailable", targetPlan: null, effectiveAt: null, canCheckStatus: false, current: null });
});

test("terminal changes are shown only around their effective date", async () => {
  const recent = setup({ latest: record("completed", "2027-02-20T00:00:00.000Z") });
  assert.equal((await resolvePlanChangeOverview(input(), recent.dependencies)).current?.state, "completed");
  const old = setup({ latest: record("not_applied", "2026-12-01T00:00:00.000Z") });
  assert.equal((await resolvePlanChangeOverview(input(), old.dependencies)).current, null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { resolveBillingPlanChangeConfig } from "./billingPlanChangeConfigCore.ts";
import type { BillingPlanChangeRepository, PlanChangeRecord } from "./billingPlanChangeCore.ts";
import { handleBillingPlanChangePost, type PlanChangeEndpointDependencies } from "./billingPlanChangeEndpointCore.ts";
import { parsePlanChangeSnapshot, type BillingPlanChangeProvider } from "./lemonSqueezyPlanChangeProvider.ts";
import { subscriptionPayload } from "./planChangeTestFixtures.ts";

const config = { provider: "lemonsqueezy" as const, environment: "test" as const, apiKey: "test-api-key-not-real", storeId: "501229" };
const confirmed: PlanChangeRecord = {
  id: "change-1", subscriptionId: "sub-1", providerSubscriptionId: "2618348", providerCustomerId: "8001", status: "confirmed",
  direction: "upgrade", targetPlan: "pro", baselinePeriodEnd: "2027-03-31T00:00:00.000Z", conflictCode: null,
};

function setup(overrides: Partial<PlanChangeEndpointDependencies> = {}, repositoryOverrides: Partial<BillingPlanChangeRepository> = {}) {
  const counters = { repository: 0, read: 0, patch: 0 };
  const touch = <T>(value: T) => { counters.repository += 1; return value; };
  const repository: BillingPlanChangeRepository = {
    findOwnedSalon: async () => touch("salon-1"),
    findActivePlanId: async (slug) => touch(`plan-${slug}`),
    findProviderCustomerId: async () => touch("8001"),
    prepare: async () => touch({ outcome: "eligible", errorCode: null, subscriptionId: "sub-1", providerSubscriptionId: "2618348", baselinePeriodEnd: "2027-03-31T00:00:00.000Z", targetProviderVariantId: "2264940", stateToken: "token" }),
    request: async () => touch({ planChangeId: "change-1", targetProviderVariantId: "2264940" }),
    record: async () => { touch(null); },
    evaluate: async () => { touch(null); },
    latestChange: async () => touch(confirmed),
    ...repositoryOverrides,
  };
  const provider: BillingPlanChangeProvider = {
    readSubscription: async () => { counters.read += 1; return { kind: "snapshot", snapshot: parsePlanChangeSnapshot(subscriptionPayload()) }; },
    patchVariant: async () => { counters.patch += 1; return { kind: "accepted", snapshot: parsePlanChangeSnapshot(subscriptionPayload({ variant_id: 2264940, updated_at: "2027-03-01T00:00:05.000000Z" })) }; },
  };
  const dependencies: PlanChangeEndpointDependencies = {
    authenticate: async () => "owner-1",
    getConfig: () => config,
    environmentMatches: async () => true,
    repository,
    getProvider: () => provider,
    now: () => new Date("2027-03-01T00:00:00.000Z"),
    ...overrides,
  };
  return { dependencies, counters };
}
const post = (body: string | null, url = "https://app.example.invalid/api/billing/plan-change", type = "application/json") =>
  new Request(url, { method: "POST", headers: type ? { "content-type": type } : {}, body: body ?? undefined });

test("config is default-off and requires the trusted provider configuration", () => {
  const base = { BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "test", LEMONSQUEEZY_API_KEY: "k", LEMONSQUEEZY_STORE_ID: "501229" };
  assert.equal(resolveBillingPlanChangeConfig(base), null);
  assert.equal(resolveBillingPlanChangeConfig({ ...base, BILLING_PLAN_CHANGE_ENABLED: "TRUE" }), null);
  assert.deepEqual(resolveBillingPlanChangeConfig({ ...base, BILLING_PLAN_CHANGE_ENABLED: "true" }), config && { provider: "lemonsqueezy", environment: "test", apiKey: "k", storeId: "501229" });
  assert.equal(resolveBillingPlanChangeConfig({ ...base, BILLING_PLAN_CHANGE_ENABLED: "true", BILLING_ENVIRONMENT: "staging" }), null);
  assert.equal(resolveBillingPlanChangeConfig({ ...base, BILLING_PLAN_CHANGE_ENABLED: "true", BILLING_ENVIRONMENT: "live" }), null, "live needs live credentials");
});

test("disabled flag, invalid environment or DB parity failure: no repository and no provider call", async () => {
  for (const overrides of [
    { getConfig: () => null },
    { environmentMatches: async () => false },
    { environmentMatches: async () => { throw new Error("rpc down"); } },
  ] as Partial<PlanChangeEndpointDependencies>[]) {
    const { dependencies, counters } = setup(overrides);
    const result = await handleBillingPlanChangePost("request", post('{"targetPlan":"pro"}'), dependencies);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { success: false, code: "BILLING_PLAN_CHANGE_DISABLED" });
    assert.deepEqual(counters, { repository: 0, read: 0, patch: 0 });
  }
});

test("unauthenticated requests are refused first", async () => {
  const { dependencies, counters } = setup({ authenticate: async () => null });
  const result = await handleBillingPlanChangePost("request", post('{"targetPlan":"pro"}'), dependencies);
  assert.equal(result.status, 401);
  assert.deepEqual(counters, { repository: 0, read: 0, patch: 0 });
});

test("browser cannot pass provider identity, mapping, environment or extra fields", async () => {
  for (const [body, url, type] of [
    ['{"targetPlan":"pro","variantId":"2264940"}', undefined, undefined],
    ['{"targetPlan":"pro","environment":"live"}', undefined, undefined],
    ['{"targetPlan":"pro","providerSubscriptionId":"1"}', undefined, undefined],
    ['{"targetPlan":"premium"}', undefined, undefined],
    ['{"plan":"pro"}', undefined, undefined],
    ['["pro"]', undefined, undefined],
    ['{"targetPlan":"pro"}', "https://app.example.invalid/api/billing/plan-change?store=1", undefined],
    ['{"targetPlan":"pro"}', undefined, "text/plain"],
    [`{"targetPlan":"pro","x":"${"a".repeat(300)}"}`, undefined, undefined],
  ] as const) {
    const { dependencies, counters } = setup();
    const result = await handleBillingPlanChangePost("request", post(body, url, type), dependencies);
    assert.equal(result.status, 400, body);
    assert.equal(counters.read + counters.patch, 0);
  }
});

test("owner request returns only the sanitized local view", async () => {
  const { dependencies, counters } = setup();
  const result = await handleBillingPlanChangePost("request", post('{"targetPlan":"pro"}'), dependencies);
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, {
    success: true, outcome: "requested", doNotRepeat: true,
    planChange: { id: "change-1", state: "scheduled", direction: "upgrade", targetPlan: "pro", effectiveAt: "2027-03-31T00:00:00.000Z", nextAction: "none" },
  });
  assert.equal(counters.patch, 1);
  const serialized = JSON.stringify(result.body);
  for (const secret of ["2618348", "501229", "8001", "token", "test-api-key", "sub-1", "signature", "example.invalid/x"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(result.headers["Cache-Control"], "no-store");
});

test("states are coarse and completed only when the database says so", async () => {
  const cases: [PlanChangeRecord["status"], string, string][] = [
    ["requested", "pending_confirmation", "check_status_later"],
    ["unknown", "pending_confirmation", "check_status_later"],
    ["confirmed", "scheduled", "none"],
    ["manual_review", "review_required", "contact_support"],
    ["completed", "completed", "none"],
  ];
  for (const [status, state, nextAction] of cases) {
    const { dependencies, counters } = setup({}, { latestChange: async () => ({ ...confirmed, status, conflictCode: status === "manual_review" ? "plan_change_variant_unexpected" : null }) });
    const result = await handleBillingPlanChangePost("refresh", post(null, "https://app.example.invalid/api/billing/plan-change/status", ""), dependencies);
    assert.equal(result.status, 200);
    const body = result.body as { planChange: { state: string; nextAction: string } };
    assert.equal(body.planChange.state, state);
    assert.equal(body.planChange.nextAction, nextAction);
    assert.equal(JSON.stringify(result.body).includes("plan_change_variant_unexpected"), false, "internal conflict codes are not exposed");
    assert.equal(counters.patch, 0, "refresh never sends a PATCH");
  }
});

test("refresh accepts only an empty body and never a PATCH; unknown outcome tells the user not to repeat", async () => {
  const bad = setup();
  assert.equal((await handleBillingPlanChangePost("refresh", post('{"force":true}'), bad.dependencies)).status, 400);
  const unknown = setup({}, { request: async () => { throw new Error("lost"); }, latestChange: async () => ({ ...confirmed, status: "requested" }) });
  const result = await handleBillingPlanChangePost("request", post('{"targetPlan":"pro"}'), unknown.dependencies);
  assert.equal(result.status, 202);
  assert.equal((result.body as { outcome: string }).outcome, "status_unknown");
  assert.equal((result.body as { doNotRepeat: boolean }).doNotRepeat, true);
  assert.equal(unknown.counters.patch, 0);
});

test("unexpected internal errors are sanitized", async () => {
  const { dependencies } = setup({}, { findOwnedSalon: async () => { throw new Error("relation salons: secret detail"); } });
  const result = await handleBillingPlanChangePost("request", post('{"targetPlan":"pro"}'), dependencies);
  assert.deepEqual(result.body, { success: false, code: "BILLING_PLAN_CHANGE_INTERNAL_ERROR" });
});

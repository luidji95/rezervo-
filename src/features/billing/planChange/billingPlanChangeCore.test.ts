import assert from "node:assert/strict";
import test from "node:test";

import {
  PlanChangeDatabaseRejection,
  refreshPlanChange,
  requestPlanChange,
  type BillingPlanChangeRepository,
  type PlanChangePrepareRow,
  type PlanChangeRecord,
} from "./billingPlanChangeCore.ts";
import { BillingPlanChangeError } from "./billingPlanChangeErrors.ts";
import { parsePlanChangeSnapshot, type BillingPlanChangeProvider, type PlanChangePatchResult } from "./lemonSqueezyPlanChangeProvider.ts";
import { subscriptionPayload } from "./planChangeTestFixtures.ts";

const BASELINE = "2027-03-31T00:00:00.000Z";
const change = (status: PlanChangeRecord["status"] = "requested"): PlanChangeRecord => ({
  id: "change-1", subscriptionId: "sub-1", providerSubscriptionId: "2618348", providerCustomerId: "8001", status,
  direction: "upgrade", targetPlan: "pro", baselinePeriodEnd: BASELINE, conflictCode: null,
});
const eligible: PlanChangePrepareRow = {
  outcome: "eligible", errorCode: null, subscriptionId: "sub-1", providerSubscriptionId: "2618348",
  baselinePeriodEnd: BASELINE, targetProviderVariantId: "2264940", stateToken: "token-1",
};

function fakeRepository(overrides: Partial<BillingPlanChangeRepository> = {}) {
  const calls: { name: string; args?: unknown }[] = [];
  let latest: PlanChangeRecord | null = null;
  const repository: BillingPlanChangeRepository = {
    findOwnedSalon: async (userId) => { calls.push({ name: "findOwnedSalon", args: userId }); return "salon-1"; },
    findActivePlanId: async (slug) => { calls.push({ name: "findActivePlanId", args: slug }); return `plan-${slug}`; },
    findProviderCustomerId: async (id) => { calls.push({ name: "findProviderCustomerId", args: id }); return "8001"; },
    prepare: async (args) => { calls.push({ name: "prepare", args }); return eligible; },
    request: async (args) => { calls.push({ name: "request", args }); latest = change(); return { planChangeId: "change-1", targetProviderVariantId: "2264940" }; },
    record: async (args) => { calls.push({ name: "record", args }); if (latest && args.result === "accepted") latest = { ...latest, status: "confirmed" }; if (latest && args.result === "ambiguous") latest = { ...latest, status: "unknown" }; },
    evaluate: async (args) => { calls.push({ name: "evaluate", args }); },
    latestChange: async () => { calls.push({ name: "latestChange" }); return latest; },
    ...overrides,
  };
  return { repository, calls, setLatest: (value: PlanChangeRecord | null) => { latest = value; } };
}

function fakeProvider(options: { read?: Record<string, unknown> | null; patch?: () => PlanChangePatchResult | Promise<PlanChangePatchResult> } = {}) {
  const calls = { read: 0, patch: [] as { id: string; variant: string }[] };
  const provider: BillingPlanChangeProvider = {
    readSubscription: async () => {
      calls.read += 1;
      return options.read === null ? { kind: "unavailable" } : { kind: "snapshot", snapshot: parsePlanChangeSnapshot(subscriptionPayload(options.read ?? {})) };
    },
    patchVariant: async (id, variant) => {
      calls.patch.push({ id, variant });
      return options.patch ? options.patch() : { kind: "accepted", snapshot: parsePlanChangeSnapshot(subscriptionPayload({ variant_id: 2264940, updated_at: "2027-03-01T00:00:05.000000Z" })) };
    },
  };
  return { provider, calls };
}

const deps = (repository: BillingPlanChangeRepository, provider: BillingPlanChangeProvider) => ({
  repository, provider, environment: "test" as const, storeId: "501229", now: () => new Date("2027-03-01T00:00:00.000Z"),
});
const names = (calls: { name: string }[]) => calls.map((call) => call.name);

test("happy path: prepare, validated GET, durable intent, one PATCH with the database target, accepted record", async () => {
  const { repository, calls } = fakeRepository();
  const { provider, calls: providerCalls } = fakeProvider();
  const result = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(repository, provider));
  assert.equal(result.outcome, "requested");
  assert.equal(result.change?.status, "confirmed");
  assert.deepEqual(providerCalls.patch, [{ id: "2618348", variant: "2264940" }]);
  assert.deepEqual(names(calls).slice(0, 6), ["findOwnedSalon", "findActivePlanId", "prepare", "findProviderCustomerId", "request", "record"]);
  const request = calls.find((call) => call.name === "request")!.args as { stateToken: string; evidence: { providerVariantId: string; providerRenewsAt: string } };
  assert.equal(request.stateToken, "token-1");
  assert.equal(request.evidence.providerVariantId, "2264918");
  const record = calls.find((call) => call.name === "record")!.args as { result: string; evidence: { providerVariantId: string } };
  assert.equal(record.result, "accepted");
  assert.equal(record.evidence.providerVariantId, "2264940");
});

test("downgrade uses the database-recorded Starter variant, never a browser value", async () => {
  const { repository } = fakeRepository({
    prepare: async () => ({ ...eligible, targetProviderVariantId: "2264918" }),
    request: async () => ({ planChangeId: "change-2", targetProviderVariantId: "2264918" }),
  });
  const { provider, calls } = fakeProvider({ read: { variant_id: 2264940 } });
  const result = await requestPlanChange({ userId: "user-1", targetPlan: "starter" }, deps(repository, provider));
  assert.equal(result.outcome, "requested");
  assert.deepEqual(calls.patch, [{ id: "2618348", variant: "2264918" }]);
});

test("PayPal or unidentified payment processor: refused before the intent, nothing sent", async () => {
  for (const processor of ["paypal", null, "unknown"]) {
    const { repository, calls } = fakeRepository();
    const { provider, calls: providerCalls } = fakeProvider({ read: { payment_processor: processor } });
    await assert.rejects(requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(repository, provider)),
      (error) => error instanceof BillingPlanChangeError && error.code === "BILLING_PLAN_CHANGE_PAYMENT_METHOD_UNSUPPORTED");
    assert.equal(names(calls).includes("request"), false);
    assert.equal(providerCalls.patch.length, 0);
  }
});

test("provider state that does not match the local paid period is refused before the intent", async () => {
  for (const read of [
    { store_id: 440512 }, { test_mode: false }, { status: "past_due" }, { cancelled: true },
    { renews_at: "2027-04-30T00:00:00.000000Z" }, { ends_at: "2027-03-31T00:00:00.000000Z" },
    { pause: { mode: "void", resumes_at: null } }, { trial_ends_at: "2027-03-10T00:00:00.000000Z" },
  ]) {
    const { repository, calls } = fakeRepository();
    const { provider, calls: providerCalls } = fakeProvider({ read });
    await assert.rejects(requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(repository, provider)),
      (error) => error instanceof BillingPlanChangeError && error.code === "BILLING_PLAN_CHANGE_STATE_CHANGED", JSON.stringify(read));
    assert.equal(names(calls).includes("request"), false);
    assert.equal(providerCalls.patch.length, 0);
  }
});

test("provider GET unavailable sends nothing", async () => {
  const { repository, calls } = fakeRepository();
  const { provider, calls: providerCalls } = fakeProvider({ read: null });
  await assert.rejects(requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(repository, provider)),
    (error) => error instanceof BillingPlanChangeError && error.code === "BILLING_PLAN_CHANGE_PROVIDER_UNAVAILABLE");
  assert.equal(names(calls).includes("request"), false);
  assert.equal(providerCalls.patch.length, 0);
});

test("prepare refusals map to stable codes without any provider call", async () => {
  for (const [code, expected] of [
    ["BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE", "BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE"],
    ["EMPLOYEE_OVER_TARGET_LIMIT", "BILLING_PLAN_CHANGE_EMPLOYEES_OVER_TARGET"],
    ["BILLING_PLAN_CHANGE_FORBIDDEN", "BILLING_PLAN_CHANGE_FORBIDDEN"],
    ["BILLING_PLAN_CHANGE_OVERRIDE_ACTIVE", "BILLING_PLAN_CHANGE_NOT_ELIGIBLE"],
    ["BILLING_PLAN_CHANGE_ENVIRONMENT_MISMATCH", "BILLING_PLAN_CHANGE_DISABLED"],
  ] as const) {
    const { repository } = fakeRepository({ prepare: async () => ({ ...eligible, outcome: "rejected", errorCode: code }) });
    const { provider, calls } = fakeProvider();
    await assert.rejects(requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(repository, provider)),
      (error) => error instanceof BillingPlanChangeError && error.code === expected, code);
    assert.equal(calls.read + calls.patch.length, 0);
  }
});

test("an existing pending change is reported, never re-dispatched (prepare or concurrent request)", async () => {
  const pending = fakeRepository({ prepare: async () => ({ ...eligible, outcome: "rejected", errorCode: "BILLING_PLAN_CHANGE_PENDING" }) });
  pending.setLatest(change("unknown"));
  const first = fakeProvider();
  const viaPrepare = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(pending.repository, first.provider));
  assert.equal(viaPrepare.outcome, "already_pending");
  assert.equal(first.calls.read + first.calls.patch.length, 0);

  const race = fakeRepository({ request: async () => { throw new PlanChangeDatabaseRejection("BILLING_PLAN_CHANGE_PENDING"); } });
  race.setLatest(change("requested"));
  const second = fakeProvider();
  const viaRequest = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(race.repository, second.provider));
  assert.equal(viaRequest.outcome, "already_pending");
  assert.equal(second.calls.patch.length, 0);
});

test("unknown request outcome (lost DB response) never dispatches", async () => {
  const { repository } = fakeRepository({ request: async () => { throw new Error("network"); } });
  const { provider, calls } = fakeProvider();
  const result = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(repository, provider));
  assert.equal(result.outcome, "status_unknown");
  assert.equal(calls.patch.length, 0);
});

test("ambiguous or throwing PATCH is recorded as ambiguous, single dispatch", async () => {
  for (const patch of [() => ({ kind: "ambiguous" as const }), () => { throw new Error("socket hang up"); }]) {
    const { repository, calls } = fakeRepository();
    const { provider, calls: providerCalls } = fakeProvider({ patch });
    const result = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(repository, provider));
    assert.equal(result.outcome, "requested");
    assert.equal(result.change?.status, "unknown");
    assert.equal(providerCalls.patch.length, 1);
    assert.deepEqual((calls.find((call) => call.name === "record")!.args as { result: string; evidence: unknown }), {
      environment: "test", planChangeId: "change-1", result: "ambiguous", evidence: null, now: "2027-03-01T00:00:00.000Z",
    });
  }
});

test("record failure after the PATCH: one idempotent DB replay, never a second PATCH, never a false outcome", async () => {
  let attempts = 0;
  const flaky = fakeRepository({ record: async () => { attempts += 1; if (attempts === 1) throw new Error("lost response"); } });
  const one = fakeProvider();
  const replayed = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(flaky.repository, one.provider));
  assert.equal(replayed.outcome, "requested");
  assert.equal(attempts, 2);
  assert.equal(one.calls.patch.length, 1);

  const down = fakeRepository({ record: async () => { throw new Error("database down"); } });
  const two = fakeProvider();
  const unknown = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(down.repository, two.provider));
  assert.equal(unknown.outcome, "status_unknown");
  assert.equal(unknown.change?.status, "requested", "never reported as not_applied or completed");
  assert.equal(two.calls.patch.length, 1);
});

test("refresh never sends a PATCH: GET -> observed -> evaluate for a blocking change", async () => {
  const { repository, calls, setLatest } = fakeRepository();
  setLatest(change("unknown"));
  const { provider, calls: providerCalls } = fakeProvider({ read: { variant_id: 2264940, updated_at: "2027-03-01T00:00:05.000000Z" } });
  const result = await refreshPlanChange({ userId: "user-1" }, deps(repository, provider));
  assert.equal(result.outcome, "current");
  assert.equal(providerCalls.read, 1);
  assert.equal(providerCalls.patch.length, 0);
  assert.deepEqual(names(calls).filter((name) => name === "record" || name === "evaluate"), ["record", "evaluate"]);
  assert.equal((calls.find((call) => call.name === "record")!.args as { result: string }).result, "observed");
});

test("refresh without a pending change makes no provider call; unavailable GET still evaluates", async () => {
  const none = fakeRepository();
  const a = fakeProvider();
  assert.deepEqual(await refreshPlanChange({ userId: "user-1" }, deps(none.repository, a.provider)), { outcome: "none", change: null });
  assert.equal(a.calls.read + a.calls.patch.length, 0);

  const done = fakeRepository();
  done.setLatest(change("completed"));
  const b = fakeProvider();
  assert.equal((await refreshPlanChange({ userId: "user-1" }, deps(done.repository, b.provider))).outcome, "current");
  assert.equal(b.calls.read + b.calls.patch.length, 0);

  const blocked = fakeRepository();
  blocked.setLatest(change("requested"));
  const c = fakeProvider({ read: null });
  const result = await refreshPlanChange({ userId: "user-1" }, deps(blocked.repository, c.provider));
  assert.equal(result.outcome === "current" && result.providerChecked, false);
  assert.deepEqual(names(blocked.calls).filter((name) => name === "record" || name === "evaluate"), ["evaluate"]);
  assert.equal(c.calls.patch.length, 0);
});

test("non-owner (manager, employee, other tenant) is refused before any database or provider work", async () => {
  const fake = fakeRepository();
  const { repository, calls } = fake;
  repository.findOwnedSalon = async (userId) => { calls.push({ name: "findOwnedSalon", args: userId }); return "forbidden"; };
  const { provider, calls: providerCalls } = fakeProvider();
  await assert.rejects(requestPlanChange({ userId: "manager-1", targetPlan: "pro" }, deps(repository, provider)),
    (error) => error instanceof BillingPlanChangeError && error.code === "BILLING_PLAN_CHANGE_FORBIDDEN");
  await assert.rejects(refreshPlanChange({ userId: "manager-1" }, deps(repository, provider)),
    (error) => error instanceof BillingPlanChangeError && error.code === "BILLING_PLAN_CHANGE_FORBIDDEN");
  assert.deepEqual(names(calls), ["findOwnedSalon", "findOwnedSalon"]);
  assert.equal(providerCalls.read + providerCalls.patch.length, 0);
});

test("customer identity: expected customer from the local subscription on GET, PATCH and status evidence", async () => {
  // GET for another customer: refused before the intent
  const get = fakeRepository();
  const getProvider = fakeProvider({ read: { customer_id: 9999 } });
  await assert.rejects(requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(get.repository, getProvider.provider)),
    (error) => error instanceof BillingPlanChangeError && error.code === "BILLING_PLAN_CHANGE_STATE_CHANGED");
  assert.equal(names(get.calls).includes("request"), false);
  assert.equal(getProvider.calls.patch.length, 0);

  // accepted PATCH body for another customer: recorded as ambiguous, no evidence passed on
  const patch = fakeRepository();
  const patchProvider = fakeProvider({ patch: () => ({ kind: "accepted", snapshot: parsePlanChangeSnapshot(subscriptionPayload({ variant_id: 2264940, customer_id: 9999 })) }) });
  const result = await requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(patch.repository, patchProvider.provider));
  assert.equal(result.change?.status, "unknown");
  assert.equal((patch.calls.find((call) => call.name === "record")!.args as { result: string; evidence: unknown }).result, "ambiguous");
  assert.equal((patch.calls.find((call) => call.name === "record")!.args as { evidence: unknown }).evidence, null);
  assert.equal(patchProvider.calls.patch.length, 1);

  // status read for another customer: not recorded as observed; evaluation still runs
  const status = fakeRepository();
  status.setLatest(change("unknown"));
  const statusProvider = fakeProvider({ read: { customer_id: 9999, variant_id: 2264940 } });
  await refreshPlanChange({ userId: "user-1" }, deps(status.repository, statusProvider.provider));
  assert.deepEqual(names(status.calls).filter((name) => name === "record" || name === "evaluate"), ["evaluate"]);

  // no expected customer: refused before the provider read
  const missing = fakeRepository({ findProviderCustomerId: async () => null });
  const missingProvider = fakeProvider();
  await assert.rejects(requestPlanChange({ userId: "user-1", targetPlan: "pro" }, deps(missing.repository, missingProvider.provider)),
    (error) => error instanceof BillingPlanChangeError && error.code === "BILLING_PLAN_CHANGE_NOT_ELIGIBLE");
  assert.equal(missingProvider.calls.read + missingProvider.calls.patch.length, 0);
});

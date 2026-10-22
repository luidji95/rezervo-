import assert from "node:assert/strict";
import test from "node:test";

import { PlanChangeDatabaseRejection, type PlanChangeProviderEvidence } from "./billingPlanChangeCore.ts";
import { SupabaseBillingPlanChangeRepository, type PlanChangeDatabaseClient } from "./supabaseBillingPlanChangeRepositoryCore.ts";

const evidence: PlanChangeProviderEvidence = {
  providerSubscriptionId: "2618348", providerCustomerId: "8001", providerStoreId: "501229", testMode: true,
  providerProductId: "1451030", providerVariantId: "2264918", providerStatus: "active", providerCancelled: false,
  providerPauseMode: null, providerTrialEndsAt: null, providerRenewsAt: "2027-03-31T00:00:00Z", providerEndsAt: null,
  providerUpdatedAt: "2027-02-28T00:00:30Z",
};
const requestInput = { salonId: "s", actorProfileId: "u", targetPlanId: "p", stateToken: "t", evidence, checkedAt: "2027-03-01T00:00:00Z", now: "2027-03-01T00:00:00Z" };

function client(rpcResult: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: PlanChangeDatabaseClient = {
    rpc: async (name, args) => { calls.push({ name, args }); return rpcResult; },
    from: () => { throw new Error("unused"); },
  };
  return { db, calls };
}

test("request passes the exact RPC arguments, including the validated provider evidence", async () => {
  const { db, calls } = client({ data: [{ outcome: "requested", plan_change_id: "c1", target_provider_variant_id: "2264940" }], error: null });
  assert.deepEqual(await new SupabaseBillingPlanChangeRepository(db).request(requestInput), { planChangeId: "c1", targetProviderVariantId: "2264940" });
  assert.equal(calls[0].name, "request_billing_plan_change_v1");
  assert.equal(calls[0].args.p_state_token, "t");
  assert.equal(calls[0].args.p_provider_variant_id, "2264918");
  assert.equal(calls[0].args.p_provider_checked_at, "2027-03-01T00:00:00Z");
});

test("only a P0001 stable code is a refusal; anything else is an unknown outcome", async () => {
  const refused = client({ data: null, error: { code: "P0001", message: "BILLING_PLAN_CHANGE_PENDING" } });
  await assert.rejects(new SupabaseBillingPlanChangeRepository(refused.db).request(requestInput),
    (error) => error instanceof PlanChangeDatabaseRejection && error.code === "BILLING_PLAN_CHANGE_PENDING");
  for (const error of [{ message: "TypeError: fetch failed" }, { code: "57014", message: "canceling statement due to statement timeout" }, { code: "P0001", message: "some free text" }]) {
    const unknown = client({ data: null, error });
    await assert.rejects(new SupabaseBillingPlanChangeRepository(unknown.db).request(requestInput),
      (thrown) => !(thrown instanceof PlanChangeDatabaseRejection), JSON.stringify(error));
  }
  const malformed = client({ data: [{ outcome: "requested" }], error: null });
  await assert.rejects(new SupabaseBillingPlanChangeRepository(malformed.db).request(requestInput),
    (thrown) => !(thrown instanceof PlanChangeDatabaseRejection));
});

test("record sends null evidence for an ambiguous result and fails on environment mismatch", async () => {
  const ok = client({ data: [{ outcome: "awaiting_confirmation", plan_change_status: "unknown", error_code: null }], error: null });
  await new SupabaseBillingPlanChangeRepository(ok.db).record({ environment: "test", planChangeId: "c1", result: "ambiguous", evidence: null, now: "2027-03-01T00:00:00Z" });
  assert.equal(ok.calls[0].args.p_result, "ambiguous");
  assert.equal(ok.calls[0].args.p_provider_variant_id, null);
  const mismatch = client({ data: [{ outcome: "environment_mismatch" }], error: null });
  await assert.rejects(new SupabaseBillingPlanChangeRepository(mismatch.db).record({ environment: "test", planChangeId: "c1", result: "observed", evidence, now: "x" }));
});

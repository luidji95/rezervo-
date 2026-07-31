import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BillingCheckoutRecoveryRepositoryError,
  SupabaseBillingCheckoutRecoveryRepository,
  parseCheckoutRecoveryClaimRow,
  parseCheckoutRecoveryCompletionRow,
  parseCheckoutRecoveryMappingRows,
  parseKnownProviderCheckoutIdRows,
  type CheckoutRecoverySupabaseClient,
} from "./supabaseBillingCheckoutRecoveryRepository.ts";

const checkoutId = "10000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000001";
const token = "30000000-0000-4000-8000-000000000001";
const planId = "40000000-0000-4000-8000-000000000001";
const salonId = "50000000-0000-4000-8000-000000000001";
const idempotency = "60000000-0000-4000-8000-000000000001";

function claim(overrides: Record<string, unknown> = {}) {
  return {
    claim_outcome: "claimed", recovery_attempt_id: attemptId, claim_token: token,
    checkout_session_id: checkoutId, ledger_status: "creating", provider: "lemonsqueezy",
    environment: "test", provider_session_id: "123", requested_plan_id: planId,
    salon_id: salonId, idempotency_key: idempotency,
    ledger_created_at: "2026-07-31T10:00:00Z", ledger_expires_at: "2026-07-31T10:30:00Z",
    ...overrides,
  };
}

test("claim parser accepts every contracted outcome with strict token consistency", () => {
  assert.equal(parseCheckoutRecoveryClaimRow(claim(), "test").claimOutcome, "claimed");
  for (const [outcome, status] of [["already_open", "open"], ["already_completed", "completed"], ["already_claimed", "creating"], ["manual_review", "failed"]] as const) {
    const parsed = parseCheckoutRecoveryClaimRow(claim({ claim_outcome: outcome, ledger_status: status, recovery_attempt_id: null, claim_token: null }), "test");
    assert.equal(parsed.claimOutcome, outcome); assert.equal(parsed.recoveryAttemptId, null);
  }
});

test("terminal claim outcomes ignore legacy provider session IDs", () => {
  for (const [claim_outcome, ledger_status, provider_session_id] of [
    ["already_completed", "completed", "70000000-0000-4000-8000-000000000001"],
    ["already_open", "open", "70000000-0000-4000-8000-000000000001"],
    ["already_claimed", "creating", "malformed"],
    ["manual_review", "failed", "malformed"],
  ] as const) {
    const parsed = parseCheckoutRecoveryClaimRow(claim({
      claim_outcome, ledger_status, provider_session_id,
      recovery_attempt_id: null, claim_token: null,
    }), "test");
    assert.equal(parsed.providerSessionId, null);
  }
});

test("claimed outcome keeps strict provider session ID validation", () => {
  assert.throws(() => parseCheckoutRecoveryClaimRow(claim({ provider_session_id: "70000000-0000-4000-8000-000000000001" }), "test"), BillingCheckoutRecoveryRepositoryError);
  assert.equal(parseCheckoutRecoveryClaimRow(claim({ provider_session_id: "123" }), "test").providerSessionId, "123");
  assert.equal(parseCheckoutRecoveryClaimRow(claim({ provider_session_id: null }), "test").providerSessionId, null);
});

test("claim parser rejects unknown authority, inconsistent tokens and malformed facts", () => {
  for (const overrides of [
    { claim_outcome: "private" }, { environment: "live" }, { provider: "stripe" },
    { claim_token: null }, { recovery_attempt_id: "bad" },
    { claim_outcome: "already_open", ledger_status: "open", recovery_attempt_id: attemptId, claim_token: token },
    { checkout_session_id: "bad" }, { requested_plan_id: "bad" }, { salon_id: "bad" },
    { idempotency_key: "bad" }, { ledger_created_at: "today" }, { ledger_expires_at: "today" },
    { provider_session_id: "0" }, { provider_session_id: " 123" }, { ledger_status: "private" },
    { claim_outcome: "already_open", ledger_status: "failed", recovery_attempt_id: null, claim_token: null },
    { claim_outcome: "already_completed", ledger_status: "open", recovery_attempt_id: null, claim_token: null },
    { claim_outcome: "already_claimed", ledger_status: "completed", recovery_attempt_id: null, claim_token: null },
    { claim_outcome: "manual_review", ledger_status: "creating", recovery_attempt_id: null, claim_token: null },
    { claim_outcome: "manual_review", ledger_status: "open", recovery_attempt_id: null, claim_token: null },
    { ledger_status: "open" },
  ]) assert.throws(() => parseCheckoutRecoveryClaimRow(claim(overrides), "test"), BillingCheckoutRecoveryRepositoryError);
});

test("claim parser validates RFC3339 timestamps against the real calendar", () => {
  for (const ledger_created_at of [
    "2026-02-30T10:00:00Z", "2025-02-29T10:00:00Z", "2026-13-01T10:00:00Z",
    "2026-07-31T24:00:00Z", "2026-07-31T10:60:00Z", "2026-07-31T10:00:60Z",
    "2026-07-31T10:00:00+24:00", "2026-07-31T10:00:00+02:60",
  ]) assert.throws(() => parseCheckoutRecoveryClaimRow(claim({ ledger_created_at }), "test"), BillingCheckoutRecoveryRepositoryError);

  for (const ledger_created_at of [
    "2024-02-29T10:00:00Z", "2026-07-31T10:00:00.123Z",
    "2026-07-31T10:00:00+02:00", "2026-07-31T10:00:00-05:30",
  ]) assert.equal(parseCheckoutRecoveryClaimRow(claim({ ledger_created_at }), "test").ledgerCreatedAt, ledger_created_at);
});

test("completion parser validates outcome/status consistency", () => {
  for (const completion_outcome of ["completed", "already_completed"] as const) {
    assert.deepEqual(parseCheckoutRecoveryCompletionRow({ completion_outcome, status: "completed", outcome: "still_pending" }), { completionOutcome: completion_outcome, status: "completed", outcome: "still_pending" });
  }
  assert.deepEqual(parseCheckoutRecoveryCompletionRow({ completion_outcome: "claim_lost", status: "abandoned", outcome: "claim_lost" }), { completionOutcome: "claim_lost", status: "abandoned", outcome: "claim_lost" });
  assert.deepEqual(parseCheckoutRecoveryCompletionRow({ completion_outcome: "claim_lost", status: null, outcome: null }), { completionOutcome: "claim_lost", status: null, outcome: null });
  for (const row of [
    { completion_outcome: "private", status: "completed", outcome: "still_pending" },
    { completion_outcome: "completed", status: "abandoned", outcome: "still_pending" },
    { completion_outcome: "completed", status: "completed", outcome: "private" },
    { completion_outcome: "claim_lost", status: "completed", outcome: "claim_lost" },
  ]) assert.throws(() => parseCheckoutRecoveryCompletionRow(row), BillingCheckoutRecoveryRepositoryError);
});

test("mapping and known-ID parsers are strict positive-integer contracts", () => {
  assert.deepEqual(parseCheckoutRecoveryMappingRows([{ provider_store_id: "10", provider_variant_id: "20", plans: { slug: "pro" } }]), { storeId: "10", variantId: "20", planCode: "pro" });
  assert.equal(parseCheckoutRecoveryMappingRows([]), null);
  for (const rows of [
    [{ provider_store_id: "10", provider_variant_id: "20", plans: { slug: "pro" } }, { provider_store_id: "10", provider_variant_id: "21", plans: { slug: "pro" } }],
    [{ provider_store_id: "0", provider_variant_id: "20", plans: { slug: "pro" } }],
    [{ provider_store_id: "10", provider_variant_id: "1.5", plans: { slug: "pro" } }],
    [{ provider_store_id: "10", provider_variant_id: "20", plans: { slug: "premium" } }],
    [{ provider_store_id: "10", provider_variant_id: "20", plans: [] }],
  ]) assert.throws(() => parseCheckoutRecoveryMappingRows(rows), BillingCheckoutRecoveryRepositoryError);
  assert.deepEqual([...parseKnownProviderCheckoutIdRows([{ provider_session_id: "123" }, { provider_session_id: "456" }])], ["123", "456"]);
  for (const value of [null, "", " ", "0", "1.5", "abc"]) assert.throws(() => parseKnownProviderCheckoutIdRows([{ provider_session_id: value }]), BillingCheckoutRecoveryRepositoryError);
});

class FakeFilter {
  readonly filters: Array<[string, string, unknown]> = [];
  private readonly result: { data: unknown; error: unknown };
  constructor(result: { data: unknown; error: unknown }) { this.result = result; }
  eq(column: string, value: unknown) { this.filters.push(["eq", column, value]); return this; }
  neq(column: string, value: unknown) { this.filters.push(["neq", column, value]); return this; }
  not(column: string, operator: string, value: unknown) { this.filters.push([`not:${operator}`, column, value]); return this; }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function fakeClient(input: {
  claim?: unknown; completion?: unknown; mapping?: unknown; ids?: unknown;
  claimError?: unknown; completionError?: unknown; mappingError?: unknown; idsError?: unknown;
} = {}) {
  const calls = { rpc: [] as Array<[string, Record<string, unknown>]>, tables: [] as string[], filters: [] as FakeFilter[] };
  const client: CheckoutRecoverySupabaseClient = {
    rpc(name, args) {
      calls.rpc.push([name, args]);
      const data = name.startsWith("claim_") ? (input.claim ?? claim()) : (input.completion ?? { completion_outcome: "completed", status: "completed", outcome: "still_pending" });
      const error = name.startsWith("claim_") ? (input.claimError ?? null) : (input.completionError ?? null);
      return { maybeSingle: async () => ({ data, error }) };
    },
    from(table) {
      calls.tables.push(table);
      return { select: () => {
        const mapping = table === "billing_provider_prices";
        const query = new FakeFilter({
          data: mapping ? (input.mapping ?? [{ provider_store_id: "10", provider_variant_id: "20", plans: { slug: "pro" } }]) : (input.ids ?? [{ provider_session_id: "123" }]),
          error: mapping ? (input.mappingError ?? null) : (input.idsError ?? null),
        });
        calls.filters.push(query); return query;
      } };
    },
  };
  return { client, calls };
}

test("injected client receives exact RPC arguments and trusted query filters", async () => {
  const fake = fakeClient();
  const repository = new SupabaseBillingCheckoutRecoveryRepository(fake.client);
  await repository.claimCheckoutRecovery({ checkoutSessionId: checkoutId, environment: "test", leaseSeconds: 300 });
  await repository.completeCheckoutRecoveryAttempt({ recoveryAttemptId: attemptId, claimToken: token, environment: "test", outcome: "still_pending" });
  await repository.resolveTrustedProviderMapping({ requestedPlanId: planId, environment: "test" });
  await repository.listKnownProviderCheckoutIds({ checkoutSessionId: checkoutId, environment: "test" });
  assert.deepEqual(fake.calls.rpc, [
    ["claim_billing_checkout_recovery_v1", { p_checkout_session_id: checkoutId, p_environment: "test", p_lease_duration: "300 seconds" }],
    ["complete_billing_checkout_recovery_attempt_v1", { p_recovery_attempt_id: attemptId, p_claim_token: token, p_environment: "test", p_outcome: "still_pending" }],
  ]);
  assert.deepEqual(fake.calls.tables, ["billing_provider_prices", "billing_checkout_sessions"]);
  assert.deepEqual(fake.calls.filters[0]!.filters, [["eq", "provider", "lemonsqueezy"], ["eq", "environment", "test"], ["eq", "billing_interval", "monthly"], ["eq", "plan_id", planId], ["eq", "is_active", true]]);
  assert.deepEqual(fake.calls.filters[1]!.filters, [["eq", "provider", "lemonsqueezy"], ["eq", "environment", "test"], ["neq", "id", checkoutId], ["not:is", "provider_session_id", null]]);
});

test("behavioral repository fails closed on malformed RPC/query data", async () => {
  await assert.rejects(() => new SupabaseBillingCheckoutRecoveryRepository(fakeClient({ claim: claim({ claim_outcome: "private" }) }).client).claimCheckoutRecovery({ checkoutSessionId: checkoutId, environment: "test", leaseSeconds: 300 }), BillingCheckoutRecoveryRepositoryError);
  await assert.rejects(() => new SupabaseBillingCheckoutRecoveryRepository(fakeClient({ completion: { completion_outcome: "private", status: "completed", outcome: "still_pending" } }).client).completeCheckoutRecoveryAttempt({ recoveryAttemptId: attemptId, claimToken: token, environment: "test", outcome: "still_pending" }), BillingCheckoutRecoveryRepositoryError);
  await assert.rejects(() => new SupabaseBillingCheckoutRecoveryRepository(fakeClient({ ids: [{ provider_session_id: "bad" }] }).client).listKnownProviderCheckoutIds({ checkoutSessionId: checkoutId, environment: "test" }), BillingCheckoutRecoveryRepositoryError);
});

test("Supabase failures expose only stable repository error codes", async () => {
  const privateError = { message: "private Supabase detail", details: "private SQL detail", code: "PRIVATE" };
  const cases: Array<[() => Promise<unknown>, string]> = [
    [() => new SupabaseBillingCheckoutRecoveryRepository(fakeClient({ claimError: privateError }).client).claimCheckoutRecovery({ checkoutSessionId: checkoutId, environment: "test", leaseSeconds: 300 }), "BILLING_CHECKOUT_RECOVERY_CLAIM_FAILED"],
    [() => new SupabaseBillingCheckoutRecoveryRepository(fakeClient({ completionError: privateError }).client).completeCheckoutRecoveryAttempt({ recoveryAttemptId: attemptId, claimToken: token, environment: "test", outcome: "still_pending" }), "BILLING_CHECKOUT_RECOVERY_COMPLETE_FAILED"],
    [() => new SupabaseBillingCheckoutRecoveryRepository(fakeClient({ mappingError: privateError }).client).resolveTrustedProviderMapping({ requestedPlanId: planId, environment: "test" }), "BILLING_CHECKOUT_RECOVERY_MAPPING_FAILED"],
    [() => new SupabaseBillingCheckoutRecoveryRepository(fakeClient({ idsError: privateError }).client).listKnownProviderCheckoutIds({ checkoutSessionId: checkoutId, environment: "test" }), "BILLING_CHECKOUT_RECOVERY_LEDGER_LOOKUP_FAILED"],
  ];
  for (const [operation, code] of cases) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof BillingCheckoutRecoveryRepositoryError);
      assert.equal(error.message, code);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  }
});

const source = readFileSync("src/features/billing/checkoutRecovery/supabaseBillingCheckoutRecoveryRepository.ts", "utf8");
test("repository has no direct recovery audit or business-data mutation surface", () => {
  assert.doesNotMatch(source, /\.from\("billing_checkout_recovery_attempts"\)[\s\S]*\.(?:insert|update|delete)/);
  assert.doesNotMatch(source, /markOpen|provider_order_id|resulting_subscription_id|checkout_url_hash/);
});

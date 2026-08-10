import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { LemonSqueezyCheckoutRetrievalError, type LemonSqueezyRetrievedCheckout } from "../providers/lemonSqueezyCheckoutRetrievalCore.ts";
import { runBillingCheckoutRecovery, type CheckoutRecoveryProviderGateway } from "./billingCheckoutRecoveryCore.ts";
import type { BillingCheckoutRecoveryRepository, CheckoutRecoveryAuditOutcome, CheckoutRecoveryFinalizationOutcome } from "./billingCheckoutRecoveryRepository.ts";
import { parseKnownProviderCheckoutIdRows } from "./supabaseBillingCheckoutRecoveryRepository.ts";

const ledgerId = "10000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000001";
const token = "30000000-0000-4000-8000-000000000001";
const salonId = "40000000-0000-4000-8000-000000000001";
const planId = "50000000-0000-4000-8000-000000000001";
const idempotency = "60000000-0000-4000-8000-000000000001";
const createdAt = "2026-07-31T10:00:00.000Z";
const providerCheckoutId = "7a000000-0000-0000-0000-000000000001";
const secondProviderCheckoutId = "7b000000-0000-0000-0000-000000000002";

function checkout(overrides: Partial<LemonSqueezyRetrievedCheckout> = {}): LemonSqueezyRetrievedCheckout {
  return {
    providerCheckoutId, storeId: "10", variantId: "20", customCheckoutSessionId: ledgerId,
    customSalonId: salonId, customPlanCode: "pro", customIdempotencyKey: idempotency,
    testMode: true, checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${overrides.providerCheckoutId ?? providerCheckoutId}?expires=1785493800&signature=opaque`,
    expiresAt: "2026-07-31T10:30:00.000Z", providerCreatedAt: createdAt,
    providerUpdatedAt: "2026-07-31T10:01:00.000Z", ...overrides,
  };
}

function harness(input: { providerSessionId?: string | null; claimOutcome?: "claimed" | "already_open" | "already_completed" | "already_claimed" | "manual_review"; completion?: "completed" | "claim_lost"; finalization?: CheckoutRecoveryFinalizationOutcome } = {}) {
  const calls = { claim: 0, complete: [] as CheckoutRecoveryAuditOutcome[], finalize: [] as Array<Record<string, unknown>>, retrieve: 0, list: 0, mapping: 0, known: 0 };
  const repository: BillingCheckoutRecoveryRepository = {
    async claimCheckoutRecovery() {
      calls.claim += 1;
      return {
        claimOutcome: input.claimOutcome ?? "claimed", recoveryAttemptId: input.claimOutcome === "already_claimed" ? null : attemptId,
        claimToken: input.claimOutcome === "already_claimed" ? null : token, checkoutSessionId: ledgerId,
        ledgerStatus: "creating", provider: "lemonsqueezy", environment: "test",
        providerSessionId: input.providerSessionId ?? null, requestedPlanId: planId, salonId,
        idempotencyKey: idempotency, ledgerCreatedAt: createdAt, ledgerExpiresAt: "2026-07-31T10:30:00.000Z",
      };
    },
    async completeCheckoutRecoveryAttempt(value) {
      calls.complete.push(value.outcome);
      return { completionOutcome: input.completion ?? "completed", status: input.completion === "claim_lost" ? "abandoned" : "completed", outcome: input.completion === "claim_lost" ? "claim_lost" : value.outcome };
    },
    async finalizeCheckoutRecovery(value) {
      calls.finalize.push(value);
      const finalizationOutcome = input.finalization ?? "finalized";
      if (finalizationOutcome === "claim_lost") return { finalizationOutcome, recoveryAttemptId: attemptId, ledgerStatus: "creating", attemptStatus: "abandoned", auditOutcome: "claim_lost", attemptCompletedAt: "2026-07-31T10:06:00Z" };
      if (finalizationOutcome === "provider_checkout_expired") return { finalizationOutcome, recoveryAttemptId: attemptId, ledgerStatus: "creating", attemptStatus: "completed", auditOutcome: "invalid_candidate", attemptCompletedAt: "2026-07-31T10:06:00Z" };
      if (finalizationOutcome === "provider_id_conflict" || finalizationOutcome === "ledger_state_conflict") return { finalizationOutcome, recoveryAttemptId: attemptId, ledgerStatus: "creating", attemptStatus: "completed", auditOutcome: "manual_review", attemptCompletedAt: "2026-07-31T10:06:00Z" };
      if (finalizationOutcome === "attempt_state_conflict") return { finalizationOutcome, recoveryAttemptId: attemptId, ledgerStatus: "creating", attemptStatus: "completed", auditOutcome: "still_pending", attemptCompletedAt: "2026-07-31T10:06:00Z" };
      return { finalizationOutcome, recoveryAttemptId: attemptId, ledgerStatus: "open", attemptStatus: "completed", auditOutcome: "recovered_open", attemptCompletedAt: "2026-07-31T10:06:00Z" };
    },
    async resolveTrustedProviderMapping() { calls.mapping += 1; return { storeId: "10", variantId: "20", planCode: "pro" }; },
    async listKnownProviderCheckoutIds() { calls.known += 1; return new Set(); },
  };
  const provider: CheckoutRecoveryProviderGateway = {
    async retrieveById() { calls.retrieve += 1; return checkout(); },
    async fetchListPage() { calls.list += 1; return { checkouts: [checkout()], nextPageUrl: null }; },
    buildFirstListPageUrl() { return "https://api.lemonsqueezy.com/v1/checkouts?filter%5Bstore_id%5D=10&filter%5Bvariant_id%5D=20&page%5Bnumber%5D=1&page%5Bsize%5D=50"; },
  };
  return { calls, repository, provider };
}

async function run(h = harness()) {
  return runBillingCheckoutRecovery({ checkoutSessionId: ledgerId, environment: "test", leaseSeconds: 300, pageSize: 50, maxPages: 5, providerStoreId: "10", now: () => new Date("2026-07-31T10:05:00Z"), repository: h.repository, provider: h.provider });
}

test("known provider ID uses retrieve only and exact match finalizes once", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  assert.equal(await run(h), "recovered_open");
  assert.equal(h.calls.finalize.length, 1); assert.deepEqual(h.calls.complete, []);
  assert.equal(h.calls.retrieve, 1); assert.equal(h.calls.list, 0);
});

test("retrieve-by-ID mismatch is audited as invalid_candidate without list fallback", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  h.provider.retrieveById = async () => {
    h.calls.retrieve += 1;
    return checkout({ providerCheckoutId: secondProviderCheckoutId });
  };
  assert.equal(await run(h), "invalid_candidate");
  assert.equal(h.calls.retrieve, 1);
  assert.equal(h.calls.list, 0);
  assert.deepEqual(h.calls.complete, ["invalid_candidate"]);
  assert.equal("markOpen" in h.repository, false);
});

test("known UUID Checkout IDs prevent reusing another ledger's provider checkout", async () => {
  const h = harness();
  h.repository.listKnownProviderCheckoutIds = async () => {
    h.calls.known += 1;
    return parseKnownProviderCheckoutIdRows([
      { provider_session_id: providerCheckoutId },
    ]);
  };
  assert.equal(await run(h), "invalid_candidate");
  assert.equal(h.calls.list, 1);
  assert.deepEqual(h.calls.complete, ["invalid_candidate"]);
});

test("retrieve 404 does not fall back to list and is audited provider_not_found", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  h.provider.retrieveById = async () => { h.calls.retrieve += 1; throw new LemonSqueezyCheckoutRetrievalError("provider_not_found"); };
  assert.equal(await run(h), "provider_not_found");
  assert.equal(h.calls.list, 0); assert.deepEqual(h.calls.complete, ["provider_not_found"]);
});

test("missing provider ID uses bounded list correlation and finalizes", async () => {
  const h = harness();
  assert.equal(await run(h), "recovered_open");
  assert.equal(h.calls.retrieve, 0); assert.equal(h.calls.list, 1); assert.equal(h.calls.finalize.length, 1); assert.deepEqual(h.calls.complete, []);
});

test("provider failures are audited and there is no automatic retry", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  h.provider.retrieveById = async () => { h.calls.retrieve += 1; throw new LemonSqueezyCheckoutRetrievalError("provider_unavailable"); };
  assert.equal(await run(h), "provider_unavailable");
  assert.equal(h.calls.retrieve, 1); assert.deepEqual(h.calls.complete, ["provider_unavailable"]);
});

test("page-one miss can continue to a page-two exact match", async () => {
  const h = harness();
  let page = 0;
  h.provider.fetchListPage = async () => {
    h.calls.list += 1; page += 1;
    return page === 1
      ? { checkouts: [], nextPageUrl: "https://api.lemonsqueezy.com/v1/checkouts?filter%5Bstore_id%5D=10&filter%5Bvariant_id%5D=20&page%5Bnumber%5D=2&page%5Bsize%5D=50" }
      : { checkouts: [checkout()], nextPageUrl: null };
  };
  assert.equal(await run(h), "recovered_open");
  assert.equal(h.calls.list, 2);
});

test("pagination exhaustion and ambiguous candidates are audited without mutation", async () => {
  const limit = harness();
  limit.provider.fetchListPage = async () => {
    limit.calls.list += 1;
    return { checkouts: [], nextPageUrl: "https://api.lemonsqueezy.com/v1/checkouts?filter%5Bstore_id%5D=10&filter%5Bvariant_id%5D=20&page%5Bnumber%5D=2&page%5Bsize%5D=50" };
  };
  const limitResult = await runBillingCheckoutRecovery({ checkoutSessionId: ledgerId, environment: "test", leaseSeconds: 300, pageSize: 50, maxPages: 1, providerStoreId: "10", now: () => new Date("2026-07-31T10:05:00Z"), repository: limit.repository, provider: limit.provider });
  assert.equal(limitResult, "pagination_limit_reached");
  assert.deepEqual(limit.calls.complete, ["pagination_limit_reached"]);

  const ambiguous = harness();
  ambiguous.provider.fetchListPage = async () => ({ checkouts: [checkout(), checkout({ providerCheckoutId: secondProviderCheckoutId })], nextPageUrl: null });
  assert.equal(await run(ambiguous), "ambiguous");
  assert.deepEqual(ambiguous.calls.complete, ["ambiguous"]);
});

test("only one operator claim reaches provider lookup", async () => {
  const h = harness({ claimOutcome: "already_claimed" });
  assert.equal(await run(h), "already_claimed");
  assert.deepEqual(h.calls, { claim: 1, complete: [], finalize: [], retrieve: 0, list: 0, mapping: 0, known: 0 });
});

test("terminal claim outcomes return without provider lookup or audit completion", async () => {
  for (const claimOutcome of ["already_open", "already_completed", "manual_review"] as const) {
    const h = harness({ claimOutcome });
    assert.equal(await run(h), claimOutcome);
    assert.equal(h.calls.retrieve + h.calls.list, 0);
    assert.deepEqual(h.calls.complete, []);
  }
});

test("finalizer outcomes map explicitly without generic completion", async () => {
  for (const [finalization, expected] of [["already_finalized", "already_recovered_open"], ["finalization_conflict", "finalization_conflict"], ["provider_id_conflict", "provider_id_conflict"], ["ledger_state_conflict", "ledger_state_conflict"], ["attempt_state_conflict", "attempt_state_conflict"], ["provider_checkout_expired", "provider_checkout_expired"], ["claim_lost", "claim_lost"]] as const) {
    const h = harness({ providerSessionId: providerCheckoutId, finalization });
    assert.equal(await run(h), expected); assert.equal(h.calls.finalize.length, 1); assert.deepEqual(h.calls.complete, []);
  }
});

test("mapping/store mismatch is completed as configuration_error before provider lookup", async () => {
  const h = harness();
  h.repository.resolveTrustedProviderMapping = async () => ({ storeId: "99", variantId: "20", planCode: "pro" });
  assert.equal(await run(h), "configuration_error"); assert.equal(h.calls.retrieve + h.calls.list, 0);
});

test("unexpected repository and programming errors are rethrown without audit completion", async () => {
  for (const failure of [new Error("mapping query failed"), new TypeError("programming failure")]) {
    const h = harness();
    h.repository.resolveTrustedProviderMapping = async () => { throw failure; };
    await assert.rejects(() => run(h), failure);
    assert.deepEqual(h.calls.complete, []);
  }
  const known = harness();
  known.repository.listKnownProviderCheckoutIds = async () => { throw new Error("known IDs failed"); };
  await assert.rejects(() => run(known), /known IDs failed/);
  assert.deepEqual(known.calls.complete, []);
});

test("completion failures are not hidden as provider outcomes", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  h.provider.retrieveById = async () => checkout({ storeId: "99" });
  h.repository.completeCheckoutRecoveryAttempt = async () => { throw new Error("DB private detail"); };
  await assert.rejects(() => run(h), /DB private detail/);
});

test("finalizer transport failure never falls back to generic completion", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  h.repository.finalizeCheckoutRecovery = async () => { throw new Error("private DB transport"); };
  await assert.rejects(() => run(h), /private DB transport/);
  assert.deepEqual(h.calls.complete, []);
});

test("mutation-grade identity, expiry and URL failures are audited before finalization", async () => {
  const invalid: Array<Partial<LemonSqueezyRetrievedCheckout>> = [
    { customCheckoutSessionId: null }, { customCheckoutSessionId: secondProviderCheckoutId },
    { customSalonId: null }, { customSalonId: secondProviderCheckoutId },
    { customPlanCode: null }, { customPlanCode: "starter" },
    { customIdempotencyKey: null }, { customIdempotencyKey: secondProviderCheckoutId },
    { expiresAt: null }, { expiresAt: "2026-07-31T10:04:59Z" },
    { checkoutUrl: `http://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=x` },
    { checkoutUrl: `https://evil.example/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com:444/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${secondProviderCheckoutId}?expires=1785493800&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&expires=1785493801&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1.7854938e9&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785492299&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800000&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=x&signature=y` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?signature=x&expires=1785493800&extra=no` },
    { checkoutUrl: `https://user:pass@rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=x` },
    { checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=x#fragment` },
  ];
  for (const overrides of invalid) {
    const h = harness({ providerSessionId: providerCheckoutId });
    h.provider.retrieveById = async () => { h.calls.retrieve += 1; return checkout(overrides); };
    assert.equal(await run(h), "invalid_candidate");
    assert.equal(h.calls.finalize.length, 0);
    assert.deepEqual(h.calls.complete, ["invalid_candidate"]);
  }
});

test("valid URL query order is irrelevant and hash uses the original provider string", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  const original = `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?signature=opaque&expires=1785493800`;
  h.provider.retrieveById = async () => checkout({ checkoutUrl: original });
  assert.equal(await run(h), "recovered_open");
  assert.equal(h.calls.finalize.length, 1);
  assert.equal(h.calls.finalize[0]!.checkoutUrlHash, createHash("sha256").update(original).digest("hex"));
});

test("correlation mismatch is audited and never mutates checkout or subscription", async () => {
  const h = harness({ providerSessionId: providerCheckoutId });
  h.provider.retrieveById = async () => checkout({ storeId: "99" });
  assert.equal(await run(h), "invalid_candidate"); assert.deepEqual(h.calls.complete, ["invalid_candidate"]);
  assert.equal("markOpen" in h.repository, false); assert.equal("createCheckout" in h.provider, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { LemonSqueezyCheckoutRetrievalError, type LemonSqueezyRetrievedCheckout } from "../providers/lemonSqueezyCheckoutRetrievalCore.ts";
import { runBillingCheckoutRecovery, type CheckoutRecoveryProviderGateway } from "./billingCheckoutRecoveryCore.ts";
import type { BillingCheckoutRecoveryRepository, CheckoutRecoveryAuditOutcome } from "./billingCheckoutRecoveryRepository.ts";
import { parseKnownProviderCheckoutIdRows } from "./supabaseBillingCheckoutRecoveryRepository.ts";

const ledgerId = "10000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000001";
const token = "30000000-0000-4000-8000-000000000001";
const salonId = "40000000-0000-4000-8000-000000000001";
const planId = "50000000-0000-4000-8000-000000000001";
const idempotency = "60000000-0000-4000-8000-000000000001";
const createdAt = "2026-07-31T10:00:00.000Z";

function checkout(overrides: Partial<LemonSqueezyRetrievedCheckout> = {}): LemonSqueezyRetrievedCheckout {
  return {
    providerCheckoutId: "123", storeId: "10", variantId: "20", customCheckoutSessionId: ledgerId,
    customSalonId: salonId, customPlanCode: "pro", customIdempotencyKey: idempotency,
    testMode: true, checkoutUrl: "https://app.lemonsqueezy.com/checkout/opaque",
    expiresAt: "2026-07-31T10:30:00.000Z", providerCreatedAt: createdAt,
    providerUpdatedAt: "2026-07-31T10:01:00.000Z", ...overrides,
  };
}

function harness(input: { providerSessionId?: string | null; claimOutcome?: "claimed" | "already_open" | "already_completed" | "already_claimed" | "manual_review"; completion?: "completed" | "claim_lost" } = {}) {
  const calls = { claim: 0, complete: [] as CheckoutRecoveryAuditOutcome[], retrieve: 0, list: 0, mapping: 0, known: 0 };
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
  return runBillingCheckoutRecovery({ checkoutSessionId: ledgerId, environment: "test", leaseSeconds: 300, pageSize: 50, maxPages: 5, providerStoreId: "10", repository: h.repository, provider: h.provider });
}

test("known provider ID uses retrieve only and exact match is audit-only still_pending", async () => {
  const h = harness({ providerSessionId: "123" });
  assert.equal(await run(h), "still_pending");
  assert.deepEqual(h.calls, { claim: 1, complete: ["still_pending"], retrieve: 1, list: 0, mapping: 1, known: 1 });
});

test("legacy UUIDs in known ledgers do not block provider lookup", async () => {
  const h = harness();
  h.repository.listKnownProviderCheckoutIds = async () => {
    h.calls.known += 1;
    return parseKnownProviderCheckoutIdRows([
      { provider_session_id: "70000000-0000-4000-8000-000000000001" },
      { provider_session_id: "456" },
    ]);
  };
  assert.equal(await run(h), "still_pending");
  assert.equal(h.calls.list, 1);
  assert.deepEqual(h.calls.complete, ["still_pending"]);
});

test("retrieve 404 does not fall back to list and is audited provider_not_found", async () => {
  const h = harness({ providerSessionId: "123" });
  h.provider.retrieveById = async () => { h.calls.retrieve += 1; throw new LemonSqueezyCheckoutRetrievalError("provider_not_found"); };
  assert.equal(await run(h), "provider_not_found");
  assert.equal(h.calls.list, 0); assert.deepEqual(h.calls.complete, ["provider_not_found"]);
});

test("missing provider ID uses bounded list correlation", async () => {
  const h = harness();
  assert.equal(await run(h), "still_pending");
  assert.equal(h.calls.retrieve, 0); assert.equal(h.calls.list, 1); assert.deepEqual(h.calls.complete, ["still_pending"]);
});

test("provider failures are audited and there is no automatic retry", async () => {
  const h = harness({ providerSessionId: "123" });
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
  assert.equal(await run(h), "still_pending");
  assert.equal(h.calls.list, 2);
});

test("pagination exhaustion and ambiguous candidates are audited without mutation", async () => {
  const limit = harness();
  limit.provider.fetchListPage = async () => {
    limit.calls.list += 1;
    return { checkouts: [], nextPageUrl: "https://api.lemonsqueezy.com/v1/checkouts?filter%5Bstore_id%5D=10&filter%5Bvariant_id%5D=20&page%5Bnumber%5D=2&page%5Bsize%5D=50" };
  };
  const limitResult = await runBillingCheckoutRecovery({ checkoutSessionId: ledgerId, environment: "test", leaseSeconds: 300, pageSize: 50, maxPages: 1, providerStoreId: "10", repository: limit.repository, provider: limit.provider });
  assert.equal(limitResult, "pagination_limit_reached");
  assert.deepEqual(limit.calls.complete, ["pagination_limit_reached"]);

  const ambiguous = harness();
  ambiguous.provider.fetchListPage = async () => ({ checkouts: [checkout(), checkout({ providerCheckoutId: "124" })], nextPageUrl: null });
  assert.equal(await run(ambiguous), "ambiguous");
  assert.deepEqual(ambiguous.calls.complete, ["ambiguous"]);
});

test("only one operator claim reaches provider lookup", async () => {
  const h = harness({ claimOutcome: "already_claimed" });
  assert.equal(await run(h), "already_claimed");
  assert.deepEqual(h.calls, { claim: 1, complete: [], retrieve: 0, list: 0, mapping: 0, known: 0 });
});

test("terminal claim outcomes return without provider lookup or audit completion", async () => {
  for (const claimOutcome of ["already_open", "already_completed", "manual_review"] as const) {
    const h = harness({ claimOutcome });
    assert.equal(await run(h), claimOutcome);
    assert.equal(h.calls.retrieve + h.calls.list, 0);
    assert.deepEqual(h.calls.complete, []);
  }
});

test("lease loss returned by completion overrides provider result", async () => {
  const h = harness({ providerSessionId: "123", completion: "claim_lost" });
  assert.equal(await run(h), "claim_lost"); assert.deepEqual(h.calls.complete, ["still_pending"]);
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
  const h = harness({ providerSessionId: "123" });
  h.repository.completeCheckoutRecoveryAttempt = async () => { throw new Error("DB private detail"); };
  await assert.rejects(() => run(h), /DB private detail/);
});

test("correlation mismatch is audited and never mutates checkout or subscription", async () => {
  const h = harness({ providerSessionId: "123" });
  h.provider.retrieveById = async () => checkout({ storeId: "99" });
  assert.equal(await run(h), "invalid_candidate"); assert.deepEqual(h.calls.complete, ["invalid_candidate"]);
  assert.equal("markOpen" in h.repository, false); assert.equal("createCheckout" in h.provider, false);
});

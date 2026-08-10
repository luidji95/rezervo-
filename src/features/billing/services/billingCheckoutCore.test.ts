import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MockBillingProvider } from "../providers/mockBillingProvider.ts";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";
import {
  createBillingCheckout,
  type BillingCheckoutLedger,
  type BillingCheckoutRepository,
  type BillingPriceMapping,
} from "./billingCheckoutCore.ts";
import { parseBillingCheckoutRequest } from "./billingCheckoutRequest.ts";

const actor = "20000000-0000-4000-8000-000000000001";
const salon = "20000000-0000-4000-8000-000000000002";
const key = "20000000-0000-4000-8000-000000000003";
const starterPlan = "20000000-0000-4000-8000-000000000010";
const proPlan = "20000000-0000-4000-8000-000000000011";
const now = new Date("2026-07-27T13:00:00.000Z");

class MemoryRepository implements BillingCheckoutRepository {
  owner = true;
  override = false;
  mapping: BillingPriceMapping | null = {
    id: "mapping",
    planId: starterPlan,
    planCode: "starter",
    planActive: true,
    planMonthlyPrice: 2990,
    planCurrency: "RSD",
    mappingActive: true,
    mappingAmount: 2990,
    mappingCurrency: "RSD",
    providerVariantId: "456",
    providerStoreId: "123",
    environment: "test",
  };
  ledgers = new Map<string, BillingCheckoutLedger>();
  subscriptions = new Map([[salon, { status: "trialing", planId: "pro-plan", provider: null }]]);
  sequence = 0;
  markFailedCalls = 0;
  acquisitionOutcome: "created" | "existing" = "created";
  acquiredStatus: BillingCheckoutLedger["status"] = "creating";
  environment: "test" | "live" = "test";
  acquireInputs: Array<{ salonId: string; actorProfileId: string; planId: string }> = [];

  async isSalonOwner() { return this.owner; }
  async hasActiveOverride() { return this.override; }
  async getPriceMapping() { return this.mapping; }
  async acquireCheckoutIntent(input: { salonId: string; actorProfileId: string; planId: string }) {
    this.acquireInputs.push(input);
    const active = [...this.ledgers.values()].find(
      (row) => row.salonId === input.salonId && (row.status === "creating" || row.status === "open"),
    );
    const row = active ?? {
      id: `20000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`,
      salonId: input.salonId,
      actorProfileId: input.actorProfileId,
      requestedPlanId: input.planId,
      idempotencyKey: `30000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
      status: this.acquiredStatus,
      expiresAt: null,
    };
    if (!active) this.ledgers.set(row.idempotencyKey, row);
    return {
      outcome: active ? "existing" as const : this.acquisitionOutcome,
      checkoutSession: row,
      provider: "lemonsqueezy" as const,
      environment: this.environment,
      providerSessionId: null,
    };
  }
  async findByIdempotencyKey(value: string) { return this.ledgers.get(value) ?? null; }
  async findReusableOpenSession(input: { salonId: string; planId: string }) {
    return [...this.ledgers.values()].find(
      (row) => row.salonId === input.salonId && row.requestedPlanId === input.planId && row.status === "open",
    ) ?? null;
  }
  async markExpired(id: string) {
    for (const row of this.ledgers.values()) if (row.id === id) row.status = "expired";
  }
  async insertCreating(input: { salonId: string; actorProfileId: string; planId: string; idempotencyKey: string }) {
    const existing = this.ledgers.get(input.idempotencyKey);
    if (existing) return { outcome: "existing" as const, checkoutSession: existing };
    const row: BillingCheckoutLedger = {
      id: `ledger-${++this.sequence}`,
      salonId: input.salonId,
      actorProfileId: input.actorProfileId,
      requestedPlanId: input.planId,
      idempotencyKey: input.idempotencyKey,
      status: "creating",
      expiresAt: null,
    };
    this.ledgers.set(input.idempotencyKey, row);
    return {
      outcome: "created" as const,
      checkoutSession: { ...row, status: "creating" as const },
    };
  }
  async markOpen(input: { id: string; expiresAt: string }) {
    for (const row of this.ledgers.values()) if (row.id === input.id) {
      row.status = "open";
      row.expiresAt = input.expiresAt;
    }
  }
  async markFailed(id: string) {
    this.markFailedCalls += 1;
    for (const row of this.ledgers.values()) if (row.id === id) row.status = "failed";
  }
}

const runtime = { appUrl: "https://rezervo.example", storeId: "123", environment: "test" as const, liveAllowedSalonIds: null, now: () => now };
const request = { salonId: salon, actorProfileId: actor, planCode: "starter" as const, idempotencyKey: key };

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof BillingCheckoutError && error.code === code,
  );
}

test("owner creates Starter and Pro sessions without changing subscription state", async () => {
  for (const planCode of ["starter", "pro"] as const) {
    const repo = new MemoryRepository();
    if (planCode === "pro") repo.mapping = { ...repo.mapping!, planId: proPlan, planCode: "pro", planMonthlyPrice: 5990, mappingAmount: 5990 };
    const before = structuredClone(repo.subscriptions.get(salon));
    const provider = new MockBillingProvider();
    const result = await createBillingCheckout({ ...request, planCode }, repo, provider, runtime);
    assert.equal(result.environment, "test");
    assert.deepEqual(repo.subscriptions.get(salon), before);
    assert.equal([...repo.ledgers.values()][0]?.status, "open");
    assert.equal(provider.calls[0]?.checkoutSessionId, [...repo.ledgers.values()][0]?.id);
    assert.equal(provider.calls[0]?.idempotencyKey, [...repo.ledgers.values()][0]?.idempotencyKey);
    assert.equal("checkoutSessionId" in result, false);
  }
});

test("checkout rejects a mapping from another billing environment", async () => {
  const repo = new MemoryRepository();
  repo.mapping = { ...repo.mapping!, environment: "live" };
  const provider = new MockBillingProvider();
  await expectCode(
    () => createBillingCheckout(request, repo, provider, runtime),
    "BILLING_PRICE_MISMATCH",
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(repo.ledgers.size, 0);
});

test("live pilot allowlist rejects before every repository and provider side effect", async () => {
  const repo = new MemoryRepository();
  repo.mapping = { ...repo.mapping!, environment: "live" };
  let repositoryCalls = 0;
  repo.isSalonOwner = async () => { repositoryCalls += 1; return true; };
  repo.getPriceMapping = async () => { repositoryCalls += 1; return repo.mapping; };
  repo.acquireCheckoutIntent = async (input) => {
    repositoryCalls += 1;
    return MemoryRepository.prototype.acquireCheckoutIntent.call(repo, input);
  };
  const provider = new MockBillingProvider();
  const liveRuntime = {
    ...runtime,
    environment: "live" as const,
    liveAllowedSalonIds: new Set(["20000000-0000-4000-8000-000000000099"]),
  };
  await expectCode(
    () => createBillingCheckout(request, repo, provider, liveRuntime),
    "BILLING_CHECKOUT_DISABLED",
  );
  assert.equal(repositoryCalls, 0);
  assert.equal(repo.ledgers.size, 0);
  assert.equal(provider.calls.length, 0);
});

test("allowlisted live salon reaches environment-scoped mapping and provider", async () => {
  const repo = new MemoryRepository();
  repo.mapping = { ...repo.mapping!, environment: "live" };
  repo.environment = "live";
  const provider = new MockBillingProvider();
  const result = await createBillingCheckout(request, repo, provider, {
    ...runtime,
    environment: "live",
    liveAllowedSalonIds: new Set([salon]),
  });
  assert.equal(result.environment, "live");
  assert.equal(provider.calls[0]?.environment, "live");
});

test("checkout requires mapping Store ID to match canonical provider config", async () => {
  for (const providerStoreId of ["456", "", "   "]) {
    const repo = new MemoryRepository();
    repo.mapping = { ...repo.mapping!, providerStoreId };
    const provider = new MockBillingProvider();
    await expectCode(
      () => createBillingCheckout(request, repo, provider, runtime),
      "BILLING_PRICE_MISMATCH",
    );
    assert.equal(provider.calls.length, 0);
    assert.equal(repo.ledgers.size, 0);
  }
});

test("owner-only authorization, overrides, mappings and Premium fail closed", async () => {
  const repo = new MemoryRepository();
  repo.owner = false;
  await expectCode(() => createBillingCheckout(request, repo, new MockBillingProvider(), runtime), "BILLING_OWNER_REQUIRED");
  repo.owner = true;
  repo.override = true;
  await expectCode(() => createBillingCheckout(request, repo, new MockBillingProvider(), runtime), "BILLING_OVERRIDE_ACTIVE");
  repo.override = false;
  repo.mapping = null;
  await expectCode(() => createBillingCheckout(request, repo, new MockBillingProvider(), runtime), "BILLING_PRICE_MAPPING_MISSING");
  repo.mapping = { ...new MemoryRepository().mapping!, mappingActive: false };
  await expectCode(() => createBillingCheckout(request, repo, new MockBillingProvider(), runtime), "BILLING_PLAN_NOT_AVAILABLE");
  repo.mapping = { ...new MemoryRepository().mapping!, planActive: false };
  await expectCode(() => createBillingCheckout(request, repo, new MockBillingProvider(), runtime), "BILLING_PLAN_NOT_AVAILABLE");
  assert.throws(
    () => parseBillingCheckoutRequest({ salonId: salon, planCode: "premium" }),
    (error: unknown) => error instanceof BillingCheckoutError && error.code === "INVALID_INPUT",
  );
  assert.equal(repo.acquireInputs.length, 0);
});

test("acquire receives only server-resolved identity after authorization and mapping validation", async () => {
  const repo = new MemoryRepository();
  const provider = new MockBillingProvider();
  await createBillingCheckout(
    { ...request, idempotencyKey: "20000000-0000-4000-8000-000000000099" },
    repo,
    provider,
    runtime,
  );
  assert.deepEqual(repo.acquireInputs, [{
    salonId: salon,
    actorProfileId: actor,
    planId: starterPlan,
  }]);
  assert.equal(provider.calls[0]?.idempotencyKey, [...repo.ledgers.values()][0]?.idempotencyKey);
  assert.notEqual(provider.calls[0]?.idempotencyKey, "20000000-0000-4000-8000-000000000099");
});

test("request contract rejects browser-owned billing fields", () => {
  for (const extra of [
    { amount: 1 },
    { currency: "USD" },
    { providerVariantId: "1" },
    { successUrl: "https://evil.example" },
    { environment: "live" },
  ]) {
    assert.throws(
      () => parseBillingCheckoutRequest({ salonId: salon, planCode: "starter", ...extra }),
      (error: unknown) => error instanceof BillingCheckoutError && error.code === "INVALID_INPUT",
    );
  }
});

test("two browser UUIDs share the acquired intent and only created calls provider", async () => {
  const repo = new MemoryRepository();
  const provider = new MockBillingProvider();
  const results = await Promise.allSettled([
    createBillingCheckout({ ...request, idempotencyKey: key }, repo, provider, runtime),
    createBillingCheckout({ ...request, idempotencyKey: "20000000-0000-4000-8000-000000000099" }, repo, provider, runtime),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(repo.ledgers.size, 1);
  const ledger = [...repo.ledgers.values()][0]!;
  assert.equal(provider.calls[0]?.checkoutSessionId, ledger.id);
  assert.equal(provider.calls[0]?.idempotencyKey, ledger.idempotencyKey);
  assert.notEqual(provider.calls[0]?.idempotencyKey, key);
  await expectCode(() => createBillingCheckout(request, repo, provider, runtime), "BILLING_CHECKOUT_PENDING");
});

test("existing creating and open intents are pending without provider retrieval or create", async () => {
  for (const status of ["creating", "open"] as const) {
    const repo = new MemoryRepository();
    repo.acquiredStatus = status;
    await repo.acquireCheckoutIntent({ salonId: salon, actorProfileId: actor, planId: starterPlan });
    const provider = new MockBillingProvider();
    await assert.rejects(
      () => createBillingCheckout(request, repo, provider, runtime),
      (error: unknown) => error instanceof BillingCheckoutError &&
        error.code === "BILLING_CHECKOUT_PENDING" && error.status === 202,
    );
    assert.equal(provider.calls.length, 0);
  }
});

test("existing intent for another plan is an in-progress conflict without mutation", async () => {
  const repo = new MemoryRepository();
  const first = await repo.acquireCheckoutIntent({ salonId: salon, actorProfileId: actor, planId: proPlan });
  const provider = new MockBillingProvider();
  await expectCode(() => createBillingCheckout(request, repo, provider, runtime), "BILLING_CHECKOUT_IN_PROGRESS");
  assert.equal(provider.calls.length, 0);
  assert.equal(first.checkoutSession.requestedPlanId, proPlan);
});

test("provider rejection fails the ledger while timeout remains creating for reconciliation", async () => {
  const rejectedRepo = new MemoryRepository();
  await expectCode(
    () => createBillingCheckout(request, rejectedRepo, new MockBillingProvider("rejected"), runtime),
    "BILLING_PROVIDER_REJECTED",
  );
  assert.equal([...rejectedRepo.ledgers.values()][0]?.status, "failed");
  assert.equal(rejectedRepo.markFailedCalls, 1);

  const timeoutRepo = new MemoryRepository();
  await expectCode(
    () => createBillingCheckout(request, timeoutRepo, new MockBillingProvider("timeout"), runtime),
    "BILLING_RECONCILIATION_REQUIRED",
  );
  assert.equal([...timeoutRepo.ledgers.values()][0]?.status, "creating");
  assert.equal(timeoutRepo.ledgers.size, 1);
  assert.equal(timeoutRepo.markFailedCalls, 0);
  const timeoutProvider = new MockBillingProvider();
  await expectCode(
    () => createBillingCheckout(request, timeoutRepo, timeoutProvider, runtime),
    "BILLING_CHECKOUT_PENDING",
  );
  assert.equal([...timeoutRepo.ledgers.values()][0]?.status, "creating");
  assert.equal(timeoutRepo.ledgers.size, 1);
  assert.equal(timeoutRepo.markFailedCalls, 0);
  assert.equal(timeoutProvider.calls.length, 0);
});

test("markOpen failure after provider success remains reconciliation-required and idempotent", async () => {
  const repo = new MemoryRepository();
  let markOpenCalls = 0;
  repo.markOpen = async () => {
    markOpenCalls += 1;
    throw new Error("database details must stay private");
  };
  const provider = new MockBillingProvider();

  await expectCode(
    () => createBillingCheckout(request, repo, provider, runtime),
    "BILLING_RECONCILIATION_REQUIRED",
  );
  assert.equal(provider.calls.length, 1);
  assert.equal(markOpenCalls, 1);
  assert.equal(repo.markFailedCalls, 0);
  assert.equal(repo.ledgers.size, 1);
  assert.equal([...repo.ledgers.values()][0]?.status, "creating");

  const secondProvider = new MockBillingProvider();
  await expectCode(
    () => createBillingCheckout(request, repo, secondProvider, runtime),
    "BILLING_CHECKOUT_PENDING",
  );
  assert.equal(secondProvider.calls.length, 0);
  assert.equal(repo.markFailedCalls, 0);
  assert.equal(repo.ledgers.size, 1);
  assert.equal([...repo.ledgers.values()][0]?.status, "creating");
});

test("unexpected acquire outcome/status fails closed before provider create", async () => {
  const repo = new MemoryRepository();
  repo.acquisitionOutcome = "created";
  repo.acquiredStatus = "open";
  const provider = new MockBillingProvider();
  await expectCode(() => createBillingCheckout(request, repo, provider, runtime), "BILLING_PROVIDER_UNAVAILABLE");
  assert.equal(provider.calls.length, 0);
});

test("checkout route maps pending to a sanitized HTTP 202 response", () => {
  const route = readFileSync("src/app/api/billing/checkout/route.ts", "utf8");
  assert.match(route, /error\.code === "BILLING_CHECKOUT_PENDING"/);
  assert.match(route, /Checkout preparation is already in progress\. Please try again shortly\./);
  assert.doesNotMatch(route, /checkoutSessionId|providerSessionId|idempotencyKey/);
});

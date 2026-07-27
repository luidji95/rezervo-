import assert from "node:assert/strict";
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
const now = new Date("2026-07-27T13:00:00.000Z");

class MemoryRepository implements BillingCheckoutRepository {
  owner = true;
  override = false;
  mapping: BillingPriceMapping | null = {
    id: "mapping",
    planId: "starter-plan",
    planCode: "starter",
    planActive: true,
    planMonthlyPrice: 2990,
    planCurrency: "RSD",
    mappingActive: true,
    mappingAmount: 2990,
    mappingCurrency: "RSD",
    providerVariantId: "456",
  };
  ledgers = new Map<string, BillingCheckoutLedger>();
  subscriptions = new Map([[salon, { status: "trialing", planId: "pro-plan", provider: null }]]);
  sequence = 0;

  async isSalonOwner() { return this.owner; }
  async hasActiveOverride() { return this.override; }
  async getPriceMapping() { return this.mapping; }
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
    if (this.ledgers.has(input.idempotencyKey)) throw new Error("unique");
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
    return row;
  }
  async markOpen(input: { id: string; expiresAt: string }) {
    for (const row of this.ledgers.values()) if (row.id === input.id) {
      row.status = "open";
      row.expiresAt = input.expiresAt;
    }
  }
  async markFailed(id: string) {
    for (const row of this.ledgers.values()) if (row.id === id) row.status = "failed";
  }
}

const runtime = { appUrl: "https://rezervo.example", storeId: "123", now: () => now };
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
    if (planCode === "pro") repo.mapping = { ...repo.mapping!, planId: "pro-plan", planCode: "pro", planMonthlyPrice: 5990, mappingAmount: 5990 };
    const before = structuredClone(repo.subscriptions.get(salon));
    const result = await createBillingCheckout({ ...request, planCode }, repo, new MockBillingProvider(), runtime);
    assert.equal(result.environment, "test");
    assert.deepEqual(repo.subscriptions.get(salon), before);
    assert.equal(repo.ledgers.get(key)?.status, "open");
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
  assert.throws(
    () => parseBillingCheckoutRequest({ salonId: salon, planCode: "premium" }),
    (error: unknown) => error instanceof BillingCheckoutError && error.code === "INVALID_INPUT",
  );
});

test("request contract rejects browser-owned billing fields", () => {
  for (const extra of [
    { amount: 1 },
    { currency: "USD" },
    { providerVariantId: "1" },
    { successUrl: "https://evil.example" },
  ]) {
    assert.throws(
      () => parseBillingCheckoutRequest({ salonId: salon, planCode: "starter", ...extra }),
      (error: unknown) => error instanceof BillingCheckoutError && error.code === "INVALID_INPUT",
    );
  }
});

test("same key, double click and two concurrent requests create one provider session", async () => {
  const repo = new MemoryRepository();
  const provider = new MockBillingProvider();
  const results = await Promise.allSettled([
    createBillingCheckout(request, repo, provider, runtime),
    createBillingCheckout(request, repo, provider, runtime),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(repo.ledgers.size, 1);
  await expectCode(() => createBillingCheckout(request, repo, provider, runtime), "BILLING_CHECKOUT_IN_PROGRESS");
});

test("provider rejection fails the ledger while timeout remains creating for reconciliation", async () => {
  const rejectedRepo = new MemoryRepository();
  await expectCode(
    () => createBillingCheckout(request, rejectedRepo, new MockBillingProvider("rejected"), runtime),
    "BILLING_PROVIDER_REJECTED",
  );
  assert.equal(rejectedRepo.ledgers.get(key)?.status, "failed");

  const timeoutRepo = new MemoryRepository();
  await expectCode(
    () => createBillingCheckout(request, timeoutRepo, new MockBillingProvider("timeout"), runtime),
    "BILLING_RECONCILIATION_REQUIRED",
  );
  assert.equal(timeoutRepo.ledgers.get(key)?.status, "creating");
});

test("expired open session permits a new attempt, valid open session is reused as in-progress", async () => {
  const repo = new MemoryRepository();
  repo.ledgers.set("old", {
    id: "old-ledger", salonId: salon, actorProfileId: actor, requestedPlanId: "starter-plan",
    idempotencyKey: "old", status: "open", expiresAt: "2026-07-27T12:59:00.000Z",
  });
  await createBillingCheckout({ ...request, idempotencyKey: key }, repo, new MockBillingProvider(), runtime);
  assert.equal(repo.ledgers.get("old")?.status, "expired");

  const activeRepo = new MemoryRepository();
  activeRepo.ledgers.set("active", {
    id: "active-ledger", salonId: salon, actorProfileId: actor, requestedPlanId: "starter-plan",
    idempotencyKey: "active", status: "open", expiresAt: "2026-07-27T13:20:00.000Z",
  });
  await expectCode(
    () => createBillingCheckout({ ...request, idempotencyKey: key }, activeRepo, new MockBillingProvider(), runtime),
    "BILLING_CHECKOUT_IN_PROGRESS",
  );
});

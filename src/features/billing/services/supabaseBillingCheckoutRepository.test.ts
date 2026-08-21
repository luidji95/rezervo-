import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseBillingCheckoutCurrentState,
  parseBillingCheckoutIntentAcquisition,
} from "./billingCheckoutIntent.ts";

const source = readFileSync(
  "src/features/billing/services/supabaseBillingCheckoutRepository.ts",
  "utf8",
);

function methodSource(name: string, nextName: string) {
  const start = source.indexOf(`  async ${name}`);
  const end = source.indexOf(`  async ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

for (const [name, nextName] of [
  ["markExpired", "insertCreating"],
  ["markOpen", "markFailed"],
  ["markFailed", "__classEnd"],
] as const) {
  test(`${name} scopes checkout-session mutation by provider and environment`, () => {
    const method =
      nextName === "__classEnd"
        ? source.slice(source.indexOf(`  async ${name}`))
        : methodSource(name, nextName);
    assert.match(method, /\.from\("billing_checkout_sessions"\)/);
    assert.match(method, /\.eq\("provider", "lemonsqueezy"\)/);
    assert.match(method, /\.eq\("environment", this\.environment\)/);
  });
}

test("mapping query returns Store ID and remains environment-scoped", () => {
  const method = methodSource("getPriceMapping", "acquireCheckoutIntent");
  assert.match(method, /provider_store_id/);
  assert.match(method, /\.eq\("environment", this\.environment\)/);
  assert.match(method, /providerStoreId: row\.provider_store_id/);
});

const acquireRow = {
  acquisition_outcome: "created",
  checkout_session_id: "40000000-0000-4000-8000-000000000001",
  idempotency_key: "40000000-0000-4000-8000-000000000002",
  status: "creating",
  requested_plan_id: "40000000-0000-4000-8000-000000000003",
  actor_profile_id: "40000000-0000-4000-8000-000000000004",
  provider: "lemonsqueezy",
  environment: "test",
  provider_session_id: null,
  expires_at: null,
};

test("acquire result parser accepts only the trusted active-intent contract", () => {
  const parsed = parseBillingCheckoutIntentAcquisition(
    acquireRow,
    "test",
    "40000000-0000-4000-8000-000000000005",
  );
  assert.equal(parsed.outcome, "created");
  assert.equal(parsed.checkoutSession.idempotencyKey, acquireRow.idempotency_key);
  assert.equal(parsed.checkoutSession.salonId, "40000000-0000-4000-8000-000000000005");

  for (const invalid of [
    { acquisition_outcome: "private" },
    { acquisition_outcome: "created", status: "open" },
    { acquisition_outcome: "existing", status: "completed" },
    { provider: "other" },
    { environment: "live" },
    { checkout_session_id: "bad" },
    { idempotency_key: "bad" },
    { requested_plan_id: "bad" },
    { actor_profile_id: "bad" },
    { provider_session_id: "bad" },
  ]) {
    assert.throws(
      () => parseBillingCheckoutIntentAcquisition(
        { ...acquireRow, ...invalid },
        "test",
        "40000000-0000-4000-8000-000000000005",
      ),
      /BILLING_CHECKOUT_INTENT_RESULT_INVALID/,
    );
  }
});

test("acquire RPC receives only trusted server identity arguments", () => {
  const method = methodSource("acquireCheckoutIntent", "getCheckoutSessionById");
  assert.match(method, /"acquire_billing_checkout_intent_v1"/);
  assert.match(method, /p_salon_id: input\.salonId/);
  assert.match(method, /p_actor_profile_id: input\.actorProfileId/);
  assert.match(method, /p_requested_plan_id: input\.planId/);
  assert.match(method, /p_provider: "lemonsqueezy"/);
  assert.match(method, /p_environment: this\.environment/);
  assert.doesNotMatch(method, /idempotencyKey|insertCreating|findByIdempotencyKey/);
});

test("current-state parser validates every resume authority field", () => {
  const current = {
    id: acquireRow.checkout_session_id,
    salon_id: "40000000-0000-4000-8000-000000000005",
    actor_profile_id: acquireRow.actor_profile_id,
    requested_plan_id: acquireRow.requested_plan_id,
    idempotency_key: acquireRow.idempotency_key,
    status: "open",
    created_at: "2026-08-20T13:00:00.000Z",
    expires_at: "2026-08-20T13:30:00.000Z",
    provider: "lemonsqueezy",
    environment: "test",
    provider_session_id: "50000000-0000-4000-8000-000000000001",
    checkout_url_hash: "a".repeat(64),
  };
  const parsed = parseBillingCheckoutCurrentState(current, "test");
  assert.equal(parsed.status, "open");
  assert.equal(parsed.createdAt, current.created_at);
  assert.equal(parsed.providerSessionId, current.provider_session_id);
  assert.equal(parsed.checkoutUrlHash, current.checkout_url_hash);
  for (const invalid of [
    { provider: "other" },
    { environment: "live" },
    { status: "private" },
    { salon_id: "bad" },
    { provider_session_id: "bad" },
    { checkout_url_hash: "bad" },
    { expires_at: "bad" },
    { expires_at: "2026-08-20 13:30:00+00" },
    { created_at: "bad" },
    { created_at: "2026-02-30T10:00:00Z" },
  ]) {
    assert.throws(
      () => parseBillingCheckoutCurrentState({ ...current, ...invalid }, "test"),
      /BILLING_CHECKOUT_CURRENT_STATE_INVALID/,
    );
  }
});

test("current-state recheck is read-only and scoped by ID, provider and environment", () => {
  const method = methodSource("getCheckoutSessionById", "findByIdempotencyKey");
  assert.match(method, /created_at,provider,environment,provider_session_id,checkout_url_hash/);
  assert.match(method, /\.eq\("id", id\)/);
  assert.match(method, /\.eq\("provider", "lemonsqueezy"\)/);
  assert.match(method, /\.eq\("environment", this\.environment\)/);
  assert.doesNotMatch(method, /\.update\(|\.insert\(|retrieveById/);
});

test("markOpen confirms exactly one expected creating ledger row", () => {
  const method = methodSource("markOpen", "markFailed");
  assert.match(method, /\.eq\("id", input\.id\)/);
  assert.match(method, /\.eq\("provider", "lemonsqueezy"\)/);
  assert.match(method, /\.eq\("environment", this\.environment\)/);
  assert.match(method, /\.eq\("status", "creating"\)/);
  assert.match(method, /\.select\("id"\)/);
  assert.match(method, /\.maybeSingle\(\)/);
  assert.match(method, /if \(error \|\| !data\)/);
});

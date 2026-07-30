import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  const method = methodSource("getPriceMapping", "findByIdempotencyKey");
  assert.match(method, /provider_store_id/);
  assert.match(method, /\.eq\("environment", this\.environment\)/);
  assert.match(method, /providerStoreId: row\.provider_store_id/);
});

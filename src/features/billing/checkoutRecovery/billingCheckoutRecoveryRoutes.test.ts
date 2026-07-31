import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const testRoute = readFileSync("src/app/api/internal/billing/recover-checkout/test/route.ts", "utf8");
const liveRoute = readFileSync("src/app/api/internal/billing/recover-checkout/live/route.ts", "utf8");
const handler = readFileSync("src/features/billing/checkoutRecovery/billingCheckoutRecoveryRouteHandler.ts", "utf8");

test("routes bind compile-time trusted environments without a legacy alias", () => {
  assert.match(testRoute, /handleBillingCheckoutRecoveryRoute\(request, "test"\)/);
  assert.match(liveRoute, /handleBillingCheckoutRecoveryRoute\(request, "live"\)/);
  for (const source of [testRoute, liveRoute]) assert.doesNotMatch(source, /searchParams|request\.json|get\("environment"\)/);
});

test("shared handler binds config, provider and repository to trusted config", () => {
  assert.match(handler, /resolveBillingCheckoutRecoveryConfig\(process\.env, trustedEnvironment\)/);
  assert.match(handler, /environment: trustedEnvironment/);
  assert.match(handler, /new LemonSqueezyCheckoutRetrievalClient\(config\.provider, fetch\)/);
  assert.match(handler, /createSupabaseBillingCheckoutRecoveryRepository\(\)/);
  assert.doesNotMatch(handler, /WORKER_SECRET|RECONCILIATION_SECRET|WEBHOOK_SECRET|VERCEL_AUTOMATION/);
});

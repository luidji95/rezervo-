import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const legacyRoute = readFileSync("src/app/api/internal/billing/process-pending/route.ts", "utf8");
const testRoute = readFileSync("src/app/api/internal/billing/process-pending/test/route.ts", "utf8");
const liveRoute = readFileSync("src/app/api/internal/billing/process-pending/live/route.ts", "utf8");
const handler = readFileSync("src/features/billing/retryWorker/billingWebhookRetryRouteHandler.ts", "utf8");
const repository = readFileSync("src/features/billing/retryWorker/supabaseBillingWebhookRetryRepository.ts", "utf8");

test("legacy and explicit test routes use literal test while live uses literal live", () => {
  assert.match(legacyRoute, /handleBillingWebhookRetryRoute\(request, "test"\)/);
  assert.match(testRoute, /handleBillingWebhookRetryRoute\(request, "test"\)/);
  assert.match(liveRoute, /handleBillingWebhookRetryRoute\(request, "live"\)/);
  for (const source of [legacyRoute, testRoute, liveRoute]) {
    assert.doesNotMatch(source, /searchParams|request\.headers|get\("environment"\)|request\.json/);
  }
});

test("shared handler binds config, repository and worker to one trusted environment", () => {
  assert.match(handler, /getBillingWebhookRetryWorkerConfig\(trustedEnvironment\)/);
  assert.match(handler, /new SupabaseBillingWebhookRetryRepository\(trustedEnvironment\)/);
  assert.match(handler, /environment: trustedEnvironment/);
  assert.doesNotMatch(handler, /NODE_ENV|VERCEL_ENV|LEMONSQUEEZY_API_KEY|fetch\(/);
});

test("runtime repository claims through v2 with its server-owned environment and has no v1 fallback", () => {
  assert.match(repository, /claim_pending_billing_webhook_events_v2/);
  assert.match(repository, /p_environment: this\.environment/);
  assert.doesNotMatch(repository, /claim_pending_billing_webhook_events_v1/);
  assert.match(repository, /processSubscriptionCreated\(eventId\)/);
  assert.match(repository, /processSubscriptionUpdated\(eventId\)/);
});

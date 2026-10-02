import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const legacyRoute = readFileSync(
  "src/app/api/billing/webhooks/lemonsqueezy/route.ts",
  "utf8",
);
const testRoute = readFileSync(
  "src/app/api/billing/webhooks/lemonsqueezy/test/route.ts",
  "utf8",
);
const liveRoute = readFileSync(
  "src/app/api/billing/webhooks/lemonsqueezy/live/route.ts",
  "utf8",
);
const sharedHandler = readFileSync(
  "src/features/billing/webhooks/lemonSqueezyWebhookRouteHandler.ts",
  "utf8",
);
const configSource = readFileSync(
  "src/features/billing/webhooks/billingWebhookConfigCore.ts",
  "utf8",
);
const repositorySource = readFileSync(
  "src/features/billing/webhooks/supabaseBillingWebhookEventRepository.ts",
  "utf8",
);

test("routes bind compile-time environments to one shared handler", () => {
  assert.match(legacyRoute, /handleLemonSqueezyWebhookRequest\(request, "test"\)/);
  assert.match(testRoute, /handleLemonSqueezyWebhookRequest\(request, "test"\)/);
  assert.match(liveRoute, /handleLemonSqueezyWebhookRequest\(request, "live"\)/);
  for (const route of [legacyRoute, testRoute, liveRoute]) {
    assert.match(route, /handleLemonSqueezyWebhookRequest/);
    assert.doesNotMatch(route, /searchParams|request\.json|NODE_ENV|VERCEL_ENV/);
  }
  assert.match(legacyRoute, /Compatibility alias/);
  assert.doesNotMatch(legacyRoute, /redirect/i);
});

test("shared handler preserves raw-body and response contracts", () => {
  assert.match(sharedHandler, /request\.headers\.get\("x-signature"\)/);
  assert.match(sharedHandler, /rawBody = await request\.text\(\)/);
  assert.match(
    sharedHandler,
    /ingestLemonSqueezyWebhook\(\{[\s\S]*rawBody,[\s\S]*signature,[\s\S]*environment: config\.environment/,
  );
  assert.match(sharedHandler, /success: true, status: result\.status/);
  assert.match(sharedHandler, /Cache-Control": "no-store"/);
  assert.doesNotMatch(sharedHandler, /request\.json\(\)/);
});

test("live capability has a distinct flag and secret with no test fallback", () => {
  assert.match(configSource, /BILLING_LIVE_WEBHOOKS_ENABLED/);
  assert.match(configSource, /LEMONSQUEEZY_LIVE_WEBHOOK_SECRET/);
  assert.match(
    configSource,
    /trustedEnvironment === "test"[\s\S]*LEMONSQUEEZY_WEBHOOK_SECRET[\s\S]*LEMONSQUEEZY_LIVE_WEBHOOK_SECRET/,
  );
  assert.doesNotMatch(configSource, /NODE_ENV|VERCEL_ENV/);
});

test("invoice evidence uses one narrow RPC and does not forward PII or raw payload", () => {
  assert.match(repositorySource, /ingest_billing_subscription_invoice_evidence_v1/);
  assert.match(repositorySource, /providerInvoiceId/);
  for (const forbidden of ["customer_email", "billing_address", "card_brand", "invoice_url", "rawBody", "signature", "authorization"]) {
    assert.doesNotMatch(repositorySource, new RegExp(forbidden, "i"));
  }
});

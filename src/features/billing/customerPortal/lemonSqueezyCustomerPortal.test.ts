import assert from "node:assert/strict";
import test from "node:test";
import { BillingCustomerPortalError } from "./billingCustomerPortalErrors.ts";
import { getRedactedPortalUrlShape, LemonSqueezyCustomerPortalProvider, validateCustomerPortalUrl } from "./lemonSqueezyCustomerPortal.ts";

const hosts = new Set(["allowed.example.com"]);
const portalUrl = "https://allowed.example.com/provider/portal/session?opaque=a%2Fb&token=secret-token";
const input = { provider: "lemonsqueezy" as const, environment: "test" as const, providerSubscriptionId: "10", providerCustomerId: "20" };
const config = { apiKey: "test-secret", storeId: "30", allowedHosts: hosts };

function jsonResponse(overrides: { type?: unknown; id?: unknown; attributes?: Record<string, unknown> } = {}) {
  return new Response(JSON.stringify({ data: { type: overrides.type ?? "subscriptions", id: overrides.id ?? "10", attributes: { customer_id: 20, store_id: 30, test_mode: true, urls: { customer_portal: portalUrl }, ...overrides.attributes } } }), { status: 200 });
}

async function expectUnavailable(provider: LemonSqueezyCustomerPortalProvider) {
  await assert.rejects(() => provider.createCustomerPortal(input), (error: unknown) => error instanceof BillingCustomerPortalError && error.code === "BILLING_PORTAL_PROVIDER_UNAVAILABLE" && error.status === 502 && error.message === "BILLING_PORTAL_PROVIDER_UNAVAILABLE" && !error.message.includes("secret-token"));
}

test("valid arbitrary provider path and opaque query pass unchanged", () => {
  assert.equal(validateCustomerPortalUrl(portalUrl, hosts), portalUrl);
});

test("hostname-only HTTPS URL has the standard non-empty slash pathname", () => {
  const value = "https://allowed.example.com";
  assert.equal(getRedactedPortalUrlShape(value).pathname, "/");
  assert.equal(validateCustomerPortalUrl(value, hosts), value);
});

test("redacted URL shape never exposes query values or the full URL", () => {
  assert.deepEqual(getRedactedPortalUrlShape(portalUrl), { protocol: "https:", hostname: "allowed.example.com", pathname: "/provider/portal/session", hasQuery: true, hasFragment: false });
});

for (const [name, url] of [
  ["HTTP URL", "http://allowed.example.com/portal"],
  ["credentials", "https://user:pass@allowed.example.com/portal"],
  ["exact host mismatch", "https://other.example.com/portal"],
  ["suffix attack", "https://allowed.example.com.evil.test/portal"],
  ["protocol-relative URL", "//allowed.example.com/portal"],
  ["non-default port", "https://allowed.example.com:8443/portal"],
  ["fragment", "https://allowed.example.com/portal#secret"],
] as const) {
  test(`${name} is rejected`, () => assert.equal(validateCustomerPortalUrl(url, hosts), null));
}

test("successful Subscription API response returns only the portal URL", async () => {
  const provider = new LemonSqueezyCustomerPortalProvider(config, async () => jsonResponse());
  assert.deepEqual(await provider.createCustomerPortal(input), { url: portalUrl });
});

for (const [name, overrides] of [
  ["data.type mismatch", { type: "customers" }],
  ["subscription ID mismatch", { id: "11" }],
  ["customer ID mismatch", { attributes: { customer_id: 21 } }],
  ["store ID mismatch", { attributes: { store_id: 31 } }],
  ["live response", { attributes: { test_mode: false } }],
  ["missing portal URL", { attributes: { urls: {} } }],
  ["empty portal URL", { attributes: { urls: { customer_portal: "" } } }],
  ["unsafe portal URL", { attributes: { urls: { customer_portal: "https://allowed.example.com.evil.test/portal" } } }],
] as const) {
  test(`${name} is sanitized`, async () => expectUnavailable(new LemonSqueezyCustomerPortalProvider(config, async () => jsonResponse(overrides))));
}

for (const status of [401, 403, 404, 500]) {
  test(`provider HTTP ${status} is sanitized`, async () => expectUnavailable(new LemonSqueezyCustomerPortalProvider(config, async () => new Response("private-provider-body", { status }))));
}

test("provider 429 preserves only the rate-limited category", async () => {
  const provider = new LemonSqueezyCustomerPortalProvider(config, async () => new Response("private-provider-body", { status: 429 }));
  await assert.rejects(() => provider.createCustomerPortal(input), (error: unknown) => error instanceof BillingCustomerPortalError && error.code === "BILLING_PORTAL_RATE_LIMITED" && error.message === "BILLING_PORTAL_RATE_LIMITED");
});

test("malformed JSON is sanitized", async () => expectUnavailable(new LemonSqueezyCustomerPortalProvider(config, async () => new Response("not-json", { status: 200 }))));

test("timeout AbortError is sanitized", async () => {
  const provider = new LemonSqueezyCustomerPortalProvider(config, async (_url, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))), 1);
  await expectUnavailable(provider);
});

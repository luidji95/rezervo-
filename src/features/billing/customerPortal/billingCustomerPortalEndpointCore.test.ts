import assert from "node:assert/strict";
import test from "node:test";
import { handleBillingCustomerPortalPost, type PortalEndpointDependencies } from "./billingCustomerPortalEndpointCore.ts";
import { BillingCustomerPortalError } from "./billingCustomerPortalErrors.ts";

const linked = { provider: "lemonsqueezy" as const, environment: "test" as const, providerSubscriptionId: "subscription-server-owned", providerCustomerId: "customer-server-owned", status: "active" };
const successUrl = "https://allowed.example.com/arbitrary?opaque=token";

function dependencies(subscription: typeof linked | "forbidden" | null = linked, providerError?: BillingCustomerPortalError): PortalEndpointDependencies {
  return {
    authenticate: async () => ({ userId: "owner", repository: { findOwnerSubscription: async () => subscription } }),
    getProvider: () => ({ createCustomerPortal: async () => { if (providerError) throw providerError; return { url: successUrl }; } }),
  };
}

function request(body?: string, bearer = true) { return new Request("https://rezervo.test/api/billing/customer-portal", { method: "POST", headers: bearer ? { Authorization: "Bearer token" } : {}, ...(body === undefined ? {} : { body }) }); }

async function expectStatus(name: string, expected: number, deps: PortalEndpointDependencies, req = request()) {
  const result = await handleBillingCustomerPortalPost(req, deps);
  assert.equal(result.status, expected, name);
  assert.equal(result.headers["Cache-Control"], "no-store");
  return result;
}

test("missing bearer session returns sanitized 401 and no-store", async () => {
  await expectStatus("unauthorized", 401, { ...dependencies(), authenticate: async () => null }, request(undefined, false));
});

for (const role of ["employee", "manager"]) test(`${role} returns 403`, async () => { await expectStatus(role, 403, dependencies("forbidden")); });
for (const status of ["active", "cancelled", "past_due"] as const) test(`owner ${status} succeeds`, async () => {
  const result = await expectStatus(status, 200, dependencies({ ...linked, status }));
  assert.deepEqual(result.body, { success: true, portal: { url: successUrl } });
});
for (const status of ["trialing", "expired"] as const) test(`owner ${status} returns 409`, async () => { await expectStatus(status, 409, dependencies({ ...linked, status })); });

test("non-empty body is rejected before it can supply salon or provider identifiers", async () => {
  await expectStatus("body", 400, dependencies(), request(JSON.stringify({ salonId: "browser", providerSubscriptionId: "browser" })));
});

test("disabled provider factory maps to sanitized 503", async () => {
  await expectStatus("disabled", 503, { ...dependencies(), getProvider: () => { throw new BillingCustomerPortalError("BILLING_PORTAL_DISABLED", 503); } });
});

test("provider 429 remains sanitized 429", async () => {
  const result = await expectStatus("limited", 429, dependencies(linked, new BillingCustomerPortalError("BILLING_PORTAL_RATE_LIMITED", 429)));
  assert.deepEqual(result.body, { success: false, code: "BILLING_PORTAL_RATE_LIMITED" });
});

test("provider failure hides raw response details", async () => {
  const result = await expectStatus("provider", 502, dependencies(linked, new BillingCustomerPortalError("BILLING_PORTAL_PROVIDER_UNAVAILABLE", 502)));
  assert.deepEqual(result.body, { success: false, code: "BILLING_PORTAL_PROVIDER_UNAVAILABLE" });
  assert.equal(JSON.stringify(result).includes("provider-body"), false);
});

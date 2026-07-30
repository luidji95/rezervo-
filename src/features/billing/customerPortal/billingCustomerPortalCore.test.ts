import assert from "node:assert/strict";
import test from "node:test";
import { canOpenCustomerPortal, openBillingCustomerPortal } from "./billingCustomerPortalCore.ts";
import { isBillingCustomerPortalConfigured, parsePortalAllowedHosts } from "./billingCustomerPortalConfigCore.ts";
import { BillingCustomerPortalError } from "./billingCustomerPortalErrors.ts";

const validEnv = { BILLING_CUSTOMER_PORTAL_ENABLED: "true", BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "test", LEMONSQUEEZY_API_KEY: "test-key", LEMONSQUEEZY_STORE_ID: "440512", LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "rezervo.lemonsqueezy.com" };
const subscription = { provider: "lemonsqueezy" as const, environment: "test" as const, providerSubscriptionId: "123", providerCustomerId: "456", status: "active" };

for (const [name, patch] of [
  ["missing flag", { BILLING_CUSTOMER_PORTAL_ENABLED: undefined }],
  ["false flag", { BILLING_CUSTOMER_PORTAL_ENABLED: "false" }],
  ["wrong provider", { BILLING_PROVIDER: "other" }],
  ["live environment", { BILLING_ENVIRONMENT: "live" }],
  ["runtime alias without billing environment", { BILLING_ENVIRONMENT: undefined, NODE_ENV: "test", VERCEL_ENV: "preview" }],
  ["missing API key", { LEMONSQUEEZY_API_KEY: "" }],
  ["missing Store ID", { LEMONSQUEEZY_STORE_ID: "" }],
  ["missing allowlist", { LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "" }],
  ["wildcard host", { LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "*.lemonsqueezy.com" }],
  ["protocol in host", { LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "https://rezervo.lemonsqueezy.com" }],
  ["path in host", { LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "rezervo.lemonsqueezy.com/billing" }],
  ["port in host", { LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "rezervo.lemonsqueezy.com:443" }],
  ["suffix/path injection", { LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "rezervo.lemonsqueezy.com.evil.test/rezervo.lemonsqueezy.com" }],
] as const) {
  test(`config rejects ${name}`, () => assert.equal(isBillingCustomerPortalConfigured({ ...validEnv, ...patch }), false));
}

test("config accepts one exact host", () => assert.equal(isBillingCustomerPortalConfigured(validEnv), true));
test("config accepts and normalizes multiple exact hosts", () => assert.deepEqual([...parsePortalAllowedHosts(" A.Example.com, b.example.com ")!], ["a.example.com", "b.example.com"]));

test("overview eligibility supports active, cancelled and past_due owners", () => {
  for (const status of ["active", "cancelled", "past_due"]) assert.equal(canOpenCustomerPortal({ isOwner: true, configured: true, subscription: { ...subscription, status } }), true);
});

test("overview eligibility rejects managers, employees, disabled flag and unavailable states", () => {
  assert.equal(canOpenCustomerPortal({ isOwner: false, configured: true, subscription }), false);
  assert.equal(canOpenCustomerPortal({ isOwner: true, configured: false, subscription }), false);
  for (const status of ["trialing", "expired"]) assert.equal(canOpenCustomerPortal({ isOwner: true, configured: true, subscription: { ...subscription, status } }), false);
});

test("core forwards only repository-derived IDs", async () => {
  let received: unknown;
  const provider = { createCustomerPortal: async (value: typeof subscription) => { received = value; return { url: "https://example.test/portal" }; } };
  await openBillingCustomerPortal({ userId: "user", repository: { findOwnerSubscription: async () => subscription }, provider });
  assert.deepEqual(received, subscription);
});

test("core maps non-owner to forbidden", async () => {
  await assert.rejects(() => openBillingCustomerPortal({ userId: "u", repository: { findOwnerSubscription: async () => "forbidden" }, provider: { createCustomerPortal: async () => ({ url: "unused" }) } }), (error: unknown) => error instanceof BillingCustomerPortalError && error.code === "BILLING_PORTAL_FORBIDDEN");
});

for (const [name, unavailable] of [
  ["trialing", { ...subscription, status: "trialing" }], ["expired", { ...subscription, status: "expired" }],
  ["another provider", { ...subscription, provider: "other" as "lemonsqueezy" }], ["live environment", { ...subscription, environment: "live" as const }],
  ["missing subscription ID", { ...subscription, providerSubscriptionId: "" }], ["missing customer ID", { ...subscription, providerCustomerId: "" }],
] as const) {
  test(`core rejects ${name} subscription`, async () => {
    await assert.rejects(() => openBillingCustomerPortal({ userId: "u", repository: { findOwnerSubscription: async () => unavailable }, provider: { createCustomerPortal: async () => ({ url: "unused" }) } }), (error: unknown) => error instanceof BillingCustomerPortalError && error.code === "BILLING_PORTAL_SUBSCRIPTION_UNAVAILABLE" && error.status === 409);
  });
}

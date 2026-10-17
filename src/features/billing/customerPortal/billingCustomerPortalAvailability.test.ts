import assert from "node:assert/strict";
import test from "node:test";
import { billingPortalEnvironmentMatches, resolveBillingPortalAvailability, resolveBillingPortalAvailabilityDetail } from "./billingCustomerPortalAvailability.ts";
import { resolveBillingCustomerPortalConfig } from "./billingCustomerPortalConfigCore.ts";
import { handleBillingCustomerPortalPost } from "./billingCustomerPortalEndpointCore.ts";
import { LemonSqueezyCustomerPortalProvider } from "./lemonSqueezyCustomerPortal.ts";
import type { PortalSubscription } from "./billingCustomerPortalCore.ts";
import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type { BillingCustomerPortalConfig } from "./billingCustomerPortalConfig.ts";

function harness(environment: BillingEnvironment) {
  const calls = { rpc: 0, provider: 0 };
  const env: Record<string, string | undefined> = {
    BILLING_CUSTOMER_PORTAL_ENABLED: "true", BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: environment,
    LEMONSQUEEZY_API_KEY: "test-key", LEMONSQUEEZY_STORE_ID: "30",
    LEMONSQUEEZY_LIVE_API_KEY: "live-key", LEMONSQUEEZY_LIVE_STORE_ID: "40",
    LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS: "allowed.example.com",
  };
  const state = {
    subscription: { provider: "lemonsqueezy", environment, providerSubscriptionId: "10", providerCustomerId: "20", status: "past_due" } as PortalSubscription | "forbidden" | null,
    rpc: { data: true as unknown, error: null as unknown },
    rpcThrows: false,
    response: { type: "subscriptions", id: "10", attributes: { customer_id: 20, store_id: environment === "test" ? 30 : 40, test_mode: environment === "test", urls: { customer_portal: "https://allowed.example.com/billing?opaque=private" } } },
  };
  const dependencies = {
    authenticate: async () => ({ userId: "owner", repository: { findOwnerSubscription: async () => state.subscription } }),
    getConfig: () => {
      const config = resolveBillingCustomerPortalConfig(env);
      if (!config) throw new Error("configuration unavailable");
      return config;
    },
    environmentMatches: (requested: BillingEnvironment) => billingPortalEnvironmentMatches({ rpc: async (name, args) => {
      calls.rpc++;
      assert.equal(name, "billing_environment_matches_v1");
      assert.equal(args.p_environment, environment);
      assert.equal(requested, environment);
      if (state.rpcThrows) throw new Error("private database error");
      return state.rpc;
    } }, requested),
    getProvider: (config: BillingCustomerPortalConfig) => new LemonSqueezyCustomerPortalProvider(config, async (_url, init) => {
      calls.provider++;
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${environment}-key`);
      return Response.json({ data: state.response });
    }),
  };
  const run = (query = "", body?: string) => handleBillingCustomerPortalPost(new Request(`https://rezervo.test/api/billing/customer-portal${query}`, { method: "POST", ...(body === undefined ? {} : { body }) }), dependencies);
  const overview = (isOwner = true) => resolveBillingPortalAvailability({ isOwner, subscription: state.subscription === "forbidden" ? null : state.subscription }, dependencies);
  const detail = (isOwner = true) => resolveBillingPortalAvailabilityDetail({ isOwner, subscription: state.subscription === "forbidden" ? null : state.subscription }, dependencies);
  return { env, state, calls, run, overview, detail };
}

for (const environment of ["test", "live"] as const) {
  test(`${environment}: past_due owner gets portal without business write access`, async () => {
    const h = harness(environment);
    assert.equal(await h.overview(), true);
    assert.equal(h.calls.provider, 0);
    const result = await h.run();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true, portal: { url: h.state.response.attributes.urls.customer_portal } });
    assert.equal(result.headers["Cache-Control"], "no-store");
    assert.equal(h.calls.provider, 1);
  });

  for (const flag of [undefined, "false"]) test(`${environment}: flag ${flag} stays off`, async () => {
    const h = harness(environment); h.env.BILLING_CUSTOMER_PORTAL_ENABLED = flag;
    assert.equal(await h.overview(), false);
    assert.equal((await h.run()).status, 503);
    assert.deepEqual(h.calls, { rpc: 0, provider: 0 });
  });

  test(`${environment}: invalid server configuration blocks RPC and provider`, async () => {
    const h = harness(environment); h.env.BILLING_ENVIRONMENT = "production";
    assert.equal(await h.overview(), false);
    assert.equal((await h.run()).status, 503);
    assert.deepEqual(h.calls, { rpc: 0, provider: 0 });
  });

  test(`${environment}: credentials never fall back across environments`, async () => {
    const h = harness(environment);
    delete h.env[environment === "test" ? "LEMONSQUEEZY_API_KEY" : "LEMONSQUEEZY_LIVE_API_KEY"];
    assert.equal(await h.overview(), false);
    assert.equal((await h.run()).status, 503);
    assert.deepEqual(h.calls, { rpc: 0, provider: 0 });
  });

  for (const data of [false, null, "true", 1, [true], { matches: true }]) test(`${environment}: parity ${JSON.stringify(data)} blocks provider`, async () => {
    const h = harness(environment); h.state.rpc.data = data;
    assert.equal(await h.overview(), false);
    assert.equal((await h.run()).status, 503);
    assert.equal(h.calls.provider, 0);
  });

  for (const throws of [false, true]) test(`${environment}: RPC ${throws ? "exception" : "error"} fails closed`, async () => {
    const h = harness(environment); h.state.rpcThrows = throws; h.state.rpc.error = { message: "private database error" };
    assert.equal(await h.overview(), false);
    const result = await h.run();
    assert.equal(result.status, 503);
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal(h.calls.provider, 0);
  });

  for (const role of ["manager", "employee", "other tenant"]) test(`${environment}: ${role} cannot request portal`, async () => {
    const h = harness(environment); h.state.subscription = "forbidden";
    assert.equal(await h.overview(false), false);
    assert.equal((await h.run()).status, 403);
    assert.equal(h.calls.provider, 0);
  });

  test(`${environment}: wrong local environment blocks provider`, async () => {
    const h = harness(environment); (h.state.subscription as PortalSubscription).environment = environment === "test" ? "live" : "test";
    assert.equal(await h.overview(), false);
    assert.equal((await h.run()).status, 409);
    assert.equal(h.calls.provider, 0);
  });

  for (const status of ["trialing", "active"]) test(`${environment}: provider-free ${status === "trialing" ? "trial" : "pilot"} has no CTA`, async () => {
    const h = harness(environment);
    h.state.subscription = { status, provider: null, environment: null, providerCustomerId: "", providerSubscriptionId: "" } as unknown as PortalSubscription;
    assert.equal(await h.overview(), false);
    assert.equal((await h.run()).status, 409);
    assert.equal(h.calls.provider, 0);
  });

  test(`${environment}: availability reason is coarse and ineligible subscriptions never reach the RPC`, async () => {
    const h = harness(environment);
    assert.deepEqual(await h.detail(), { available: true, reason: null });
    assert.deepEqual(await h.detail(false), { available: false, reason: "not_owner" });
    h.calls.rpc = 0;
    h.state.subscription = { status: "trialing", provider: null, environment: null, providerCustomerId: "", providerSubscriptionId: "" } as unknown as PortalSubscription;
    assert.deepEqual(await h.detail(), { available: false, reason: "not_applicable" });
    h.state.subscription = null;
    assert.deepEqual(await h.detail(), { available: false, reason: "not_applicable" });
    assert.deepEqual(h.calls, { rpc: 0, provider: 0 });
  });

  test(`${environment}: disabled flag, invalid environment and parity failure share one generic reason`, async () => {
    const breakers: Array<(h: ReturnType<typeof harness>) => void> = [
      (h) => { h.env.BILLING_CUSTOMER_PORTAL_ENABLED = undefined; },
      (h) => { h.env.BILLING_ENVIRONMENT = "production"; },
      (h) => { h.state.rpc.data = false; },
    ];
    for (const breakIt of breakers) {
      const h = harness(environment);
      breakIt(h);
      assert.deepEqual(await h.detail(), { available: false, reason: "unavailable" });
      assert.equal(h.calls.provider, 0);
    }
  });

  test(`${environment}: browser cannot choose environment or provider IDs`, async () => {
    const h = harness(environment);
    assert.equal((await h.run("?environment=live")).status, 400);
    assert.equal((await h.run("", JSON.stringify({ environment: "live", providerSubscriptionId: "999" }))).status, 400);
    assert.deepEqual(h.calls, { rpc: 0, provider: 0 });
  });

  for (const mismatch of ["environment", "subscription", "customer", "store", "http", "host", "invalid URL"]) test(`${environment}: provider ${mismatch} mismatch never exposes URL`, async () => {
    const h = harness(environment);
    if (mismatch === "environment") h.state.response.attributes.test_mode = environment !== "test";
    if (mismatch === "subscription") h.state.response.id = "999";
    if (mismatch === "customer") h.state.response.attributes.customer_id = 999;
    if (mismatch === "store") h.state.response.attributes.store_id = 999;
    if (mismatch === "http") h.state.response.attributes.urls.customer_portal = "http://allowed.example.com/billing";
    if (mismatch === "host") h.state.response.attributes.urls.customer_portal = "https://evil.example.com/billing";
    if (mismatch === "invalid URL") h.state.response.attributes.urls.customer_portal = "not a URL";
    const result = await h.run();
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { success: false, code: "BILLING_PORTAL_PROVIDER_UNAVAILABLE" });
  });
}

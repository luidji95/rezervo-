import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKOUT_RECOVERY_WINDOW_BEFORE_MS,
  LemonSqueezyCheckoutRetrievalClient,
  LemonSqueezyCheckoutRetrievalError,
  buildLemonSqueezyCheckoutListRequest,
  buildLemonSqueezyCheckoutRetrieveRequest,
  correlateLemonSqueezyCheckoutCandidates,
  correlateLemonSqueezyCheckoutPage,
  parseLemonSqueezyCheckoutListResponse,
  parseLemonSqueezyCheckoutResponse,
  resolveLemonSqueezyCheckoutRetrievalConfig,
  searchLemonSqueezyCheckoutPages,
  type CheckoutRecoveryLedgerFacts,
  type LemonSqueezyCheckoutPage,
  type LemonSqueezyRetrievedCheckout,
} from "./lemonSqueezyCheckoutRetrievalCore.ts";

const ledgerId = "10000000-0000-4000-8000-000000000001";
const salonId = "20000000-0000-4000-8000-000000000001";
const idempotencyKey = "30000000-0000-4000-8000-000000000001";
const createdAt = "2026-07-31T10:00:00.000Z";
const providerCheckoutId = "4a000000-0000-0000-0000-000000000001";
const secondProviderCheckoutId = "4b000000-0000-0000-0000-000000000002";
const jsonApiHeaders = { "content-type": "application/vnd.api+json" };

function pageUrl(pageNumber: number, storeId = "10", variantId = "20") {
  return `https://api.lemonsqueezy.com/v1/checkouts?filter%5Bstore_id%5D=${storeId}&filter%5Bvariant_id%5D=${variantId}&page%5Bnumber%5D=${pageNumber}&page%5Bsize%5D=50`;
}

function resource(overrides: Record<string, unknown> = {}) {
  const attributes = {
    store_id: 10,
    variant_id: 20,
    checkout_data: {
      custom: {
        checkout_session_id: ledgerId,
        salon_id: salonId,
        plan_code: "pro",
        idempotency_key: idempotencyKey,
      },
      email: "must-not-survive@example.invalid",
      name: "Must Not Survive",
    },
    expires_at: "2026-07-31T10:30:00.000Z",
    created_at: createdAt,
    updated_at: "2026-07-31T10:01:00.000Z",
    test_mode: true,
    url: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=opaque`,
    ...((overrides.attributes as Record<string, unknown> | undefined) ?? {}),
  };
  return { type: "checkouts", id: providerCheckoutId, ...overrides, attributes };
}

function payload(overrides: Record<string, unknown> = {}) {
  return { data: resource(overrides) };
}

const config = { provider: "lemonsqueezy", environment: "test", apiKey: "test-secret", storeId: "10" } as const;
const liveConfig = { provider: "lemonsqueezy", environment: "live", apiKey: "live-secret", storeId: "10" } as const;

function normalized(overrides: Partial<LemonSqueezyRetrievedCheckout> = {}): LemonSqueezyRetrievedCheckout {
  return { ...parseLemonSqueezyCheckoutResponse(payload()), ...overrides };
}

function ledger(overrides: Partial<CheckoutRecoveryLedgerFacts> = {}): CheckoutRecoveryLedgerFacts {
  return {
    ledgerId,
    environment: "test",
    expectedStoreId: "10",
    expectedVariantId: "20",
    localCreatedAt: createdAt,
    localExpiresAt: "2026-07-31T10:30:00.000Z",
    expectedSalonId: salonId,
    expectedPlanCode: "pro",
    expectedIdempotencyKey: idempotencyKey,
    knownProviderCheckoutIds: new Set(),
    ...overrides,
  };
}

function invalidResponse(action: () => unknown | Promise<unknown>) {
  return assert.rejects(
    async () => action(),
    (error: unknown) => error instanceof LemonSqueezyCheckoutRetrievalError && error.kind === "invalid_provider_response",
  );
}

test("checkout parser normalizes test/live recovery fields and discards PII/raw data", () => {
  const parsed = parseLemonSqueezyCheckoutResponse(payload());
  assert.deepEqual(parsed, {
    providerCheckoutId, storeId: "10", variantId: "20",
    customCheckoutSessionId: ledgerId, customSalonId: salonId, customPlanCode: "pro",
    customIdempotencyKey: idempotencyKey, testMode: true,
    checkoutUrl: `https://rezervoo.lemonsqueezy.com/checkout/custom/${providerCheckoutId}?expires=1785493800&signature=opaque`,
    expiresAt: "2026-07-31T10:30:00.000Z", providerCreatedAt: createdAt,
    providerUpdatedAt: "2026-07-31T10:01:00.000Z",
  });
  assert.equal(JSON.stringify(parsed).includes("must-not-survive"), false);
  assert.equal(parseLemonSqueezyCheckoutResponse(payload({ attributes: { test_mode: false } })).testMode, false);
  const withOffset = parseLemonSqueezyCheckoutResponse(payload({ attributes: {
    created_at: "2026-07-31T12:00:00+02:00",
    updated_at: "2026-07-31T12:01:00+02:00",
    expires_at: "2026-07-31T12:30:00+02:00",
  } }));
  assert.equal(withOffset.providerCreatedAt, "2026-07-31T12:00:00+02:00");
  const withoutCustom = parseLemonSqueezyCheckoutResponse(payload({ attributes: { checkout_data: {} } }));
  assert.equal(withoutCustom.customCheckoutSessionId, null);
  assert.equal(withoutCustom.customSalonId, null);
});

test("checkout parser rejects malformed identity, mode, URL, dates and custom fields", async () => {
  const cases = [
    { type: "subscriptions" }, { id: " " }, { id: "123" },
    { id: providerCheckoutId.toUpperCase() }, { attributes: { store_id: 0 } },
    { attributes: { variant_id: "variant" } }, { attributes: { test_mode: "true" } },
    { attributes: { url: "http://example.invalid" } }, { attributes: { created_at: "bad" } },
    { attributes: { updated_at: "bad" } }, { attributes: { expires_at: "bad" } },
    { attributes: { created_at: "2026-07-31" } },
    { attributes: { created_at: "2026-07-31T10:00:00" } },
    { attributes: { created_at: "July 31, 2026 10:00:00 GMT" } },
    { attributes: { checkout_data: { custom: [] } } },
    { attributes: { checkout_data: { custom: { checkout_session_id: "bad" } } } },
    { attributes: { checkout_data: { custom: { salon_id: "bad" } } } },
    { attributes: { checkout_data: { custom: { plan_code: "premium" } } } },
    { attributes: { checkout_data: { custom: { idempotency_key: " " } } } },
  ];
  for (const value of cases) await invalidResponse(() => parseLemonSqueezyCheckoutResponse(payload(value)));
});

test("malicious custom keys cannot pollute normalized output or prototypes", () => {
  const custom = JSON.parse(`{"__proto__":{"polluted":true},"checkout_session_id":"${ledgerId}"}`);
  const parsed = parseLemonSqueezyCheckoutResponse(payload({ attributes: { checkout_data: { custom } } }));
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.equal("__proto__" in parsed && Object.hasOwn(parsed, "__proto__"), false);
});

test("canonical retrieval config isolates test and live credentials", () => {
  const both = {
    BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "test",
    LEMONSQUEEZY_API_KEY: "test-key", LEMONSQUEEZY_STORE_ID: "10",
    LEMONSQUEEZY_LIVE_API_KEY: "live-key", LEMONSQUEEZY_LIVE_STORE_ID: "20",
  };
  assert.equal(resolveLemonSqueezyCheckoutRetrievalConfig(both, "test").apiKey, "test-key");
  assert.throws(() => resolveLemonSqueezyCheckoutRetrievalConfig(both, "live"));
  assert.throws(() => resolveLemonSqueezyCheckoutRetrievalConfig({ ...both, BILLING_ENVIRONMENT: "live", LEMONSQUEEZY_LIVE_API_KEY: undefined }, "live"));
  assert.throws(() => resolveLemonSqueezyCheckoutRetrievalConfig({ ...both, BILLING_ENVIRONMENT: "test", LEMONSQUEEZY_API_KEY: undefined }, "test"));
});

test("retrieve request accepts only a canonical lowercase Checkout UUID and has no list fallback", async () => {
  const request = buildLemonSqueezyCheckoutRetrieveRequest(providerCheckoutId, config);
  assert.equal(request.url, `https://api.lemonsqueezy.com/v1/checkouts/${providerCheckoutId}`);
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.Accept, "application/vnd.api+json");
  assert.equal(request.init.redirect, "error");
  const calls: string[] = [];
  const client = new LemonSqueezyCheckoutRetrievalClient(config, async (url) => {
    calls.push(String(url));
    return Response.json(payload(), { headers: jsonApiHeaders });
  });
  await client.retrieveById(providerCheckoutId);
  assert.deepEqual(calls, [`https://api.lemonsqueezy.com/v1/checkouts/${providerCheckoutId}`]);
  for (const invalidId of ["", " ", "123", providerCheckoutId.toUpperCase(), providerCheckoutId.replaceAll("-", ""), `${providerCheckoutId} `, providerCheckoutId.slice(0, -1), "abc"]) {
    assert.throws(
      () => buildLemonSqueezyCheckoutRetrieveRequest(invalidId, config),
      (error: unknown) => error instanceof LemonSqueezyCheckoutRetrievalError && error.kind === "invalid_provider_response",
    );
  }
});

test("retrieve rejects a valid response whose Checkout ID differs from the requested UUID", async () => {
  const client = new LemonSqueezyCheckoutRetrievalClient(config, async () =>
    Response.json(payload({ id: secondProviderCheckoutId }), {
      headers: jsonApiHeaders,
    }),
  );
  await assert.rejects(
    () => client.retrieveById(providerCheckoutId),
    (error: unknown) =>
      error instanceof LemonSqueezyCheckoutRetrievalError &&
      error.kind === "invalid_provider_response",
  );
});

test("retrieve classifies provider and transport failures without raw details", async () => {
  for (const [status, kind] of [[401, "configuration_error"], [403, "configuration_error"], [404, "provider_not_found"], [429, "provider_unavailable"], [500, "provider_unavailable"]] as const) {
    const client = new LemonSqueezyCheckoutRetrievalClient(config, async () => new Response("private", { status }));
    await assert.rejects(() => client.retrieveById(providerCheckoutId), (error: unknown) => error instanceof LemonSqueezyCheckoutRetrievalError && error.kind === kind && !error.message.includes("private"));
  }
  for (const fetchImpl of [
    async () => { throw new TypeError("network private"); },
    (_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("private", "AbortError")))),
  ]) {
    const client = new LemonSqueezyCheckoutRetrievalClient(config, fetchImpl as typeof fetch, 5);
    await assert.rejects(() => client.retrieveById(providerCheckoutId), (error: unknown) => error instanceof LemonSqueezyCheckoutRetrievalError && error.kind === "provider_unavailable");
  }
});

test("404 semantics are endpoint-aware and never turn a list failure into not-found", async () => {
  const calls: string[] = [];
  const client = new LemonSqueezyCheckoutRetrievalClient(config, async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 404 });
  });
  await assert.rejects(
    () => client.retrieveById(providerCheckoutId),
    (error: unknown) => error instanceof LemonSqueezyCheckoutRetrievalError && error.kind === "provider_not_found",
  );

  let paginationSearchCalls = 0;
  await assert.rejects(
    async () => {
      const page = await client.list({ storeId: "10", variantId: "20", pageNumber: 1, pageSize: 50 });
      paginationSearchCalls += 1;
      return searchLemonSqueezyCheckoutPages({
        ledger: ledger(),
        firstPageUrl: pageUrl(1),
        fetchPage: async () => page,
      });
    },
    (error: unknown) => error instanceof LemonSqueezyCheckoutRetrievalError && error.kind === "invalid_provider_response",
  );
  assert.equal(paginationSearchCalls, 0);
  assert.deepEqual(calls, [
    `https://api.lemonsqueezy.com/v1/checkouts/${providerCheckoutId}`,
    pageUrl(1),
  ]);
});

test("retrieve rejects malformed 2xx, wrong content type and mode mismatch", async () => {
  const responses = [
    () => new Response("{", { status: 200, headers: jsonApiHeaders }),
    () => Response.json(payload()),
    () => Response.json(payload({ attributes: { test_mode: false } }), { headers: jsonApiHeaders }),
    () => new Response(null, { status: 302, headers: { location: "https://evil.invalid/v1/checkouts/123" } }),
  ];
  for (const response of responses) {
    const client = new LemonSqueezyCheckoutRetrievalClient(config, async () => response());
    await invalidResponse(() => client.retrieveById(providerCheckoutId));
  }
});

test("retrieve requires the exact JSON:API media type", async () => {
  for (const contentType of ["application/vnd.api+json", "application/vnd.api+json; charset=utf-8", "Application/Vnd.Api+Json; charset=utf-8"]) {
    const client = new LemonSqueezyCheckoutRetrievalClient(config, async () => Response.json(payload(), { headers: { "content-type": contentType } }));
    assert.equal((await client.retrieveById(providerCheckoutId)).providerCheckoutId, providerCheckoutId);
  }
  for (const contentType of ["application/json", "application/vnd.api+json-malicious", "text/application/vnd.api+json", ""]) {
    const client = new LemonSqueezyCheckoutRetrievalClient(config, async () => new Response(JSON.stringify(payload()), {
      status: 200,
      headers: contentType ? { "content-type": contentType } : {},
    }));
    await invalidResponse(() => client.retrieveById(providerCheckoutId));
  }
});

test("list request uses only official Store, Variant and pagination parameters", () => {
  const request = buildLemonSqueezyCheckoutListRequest({ storeId: "10", variantId: "20", pageNumber: 2, pageSize: 50 }, config);
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/checkouts");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["filter[store_id]", "filter[variant_id]", "page[number]", "page[size]"].sort());
  assert.equal(url.searchParams.get("filter[store_id]"), "10");
  assert.equal(url.searchParams.get("filter[variant_id]"), "20");
  assert.throws(() => buildLemonSqueezyCheckoutListRequest({ storeId: "11", variantId: "20", pageNumber: 1, pageSize: 50 }, config));
});

test("runtime page fetch revalidates every provider pagination URL", async () => {
  const calls: string[] = [];
  const client = new LemonSqueezyCheckoutRetrievalClient(config, async (url) => {
    calls.push(String(url));
    return Response.json({ data: [], links: { next: null } }, { headers: jsonApiHeaders });
  });
  assert.deepEqual(await client.listPageByUrl(pageUrl(2), { storeId: "10", variantId: "20" }), {
    checkouts: [], nextPageUrl: null,
  });
  await invalidResponse(() => client.listPageByUrl(
    pageUrl(2).replace("api.lemonsqueezy.com", "evil.invalid"),
    { storeId: "10", variantId: "20" },
  ));
  assert.deepEqual(calls, [pageUrl(2)]);
});

test("list parser supports empty/next pages and rejects malformed candidates or unsafe next links", async () => {
  const next = "https://api.lemonsqueezy.com/v1/checkouts?filter%5Bstore_id%5D=10&filter%5Bvariant_id%5D=20&page%5Bnumber%5D=2&page%5Bsize%5D=50";
  assert.deepEqual(parseLemonSqueezyCheckoutListResponse({ data: [], links: { next }, meta: { page: { currentPage: 1 } } }, { storeId: "10", variantId: "20" }), { checkouts: [], nextPageUrl: next });
  for (const unsafe of [
    next.replace("api.lemonsqueezy.com", "evil.invalid"),
    next.replace("/v1/checkouts", "/v1/subscriptions"),
    `${next}&filter%5Bstore_id%5D=11`,
    `${next}&filter%5Bcustom%5D=x`,
  ]) {
    await invalidResponse(() => parseLemonSqueezyCheckoutListResponse({ data: [], links: { next: unsafe } }, { storeId: "10", variantId: "20" }));
  }
  for (const rawPageValue of ["0", "-1", "01", "1.0", "1e2", "%2B1", "", "%201%20", "101"]) {
    const unsafe = next.replace("page%5Bnumber%5D=2", `page%5Bnumber%5D=${rawPageValue}`);
    await invalidResponse(() => parseLemonSqueezyCheckoutListResponse(
      { data: [], links: { next: unsafe } },
      { storeId: "10", variantId: "20" },
    ));
  }
  await invalidResponse(() => parseLemonSqueezyCheckoutListResponse({ data: [{ type: "checkouts", id: "bad", attributes: {} }] }, { storeId: "10", variantId: "20" }));
});

test("correlation requires ledger ID plus environment, identity, window and corroboration", () => {
  assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger(), [normalized()]).outcome, "exact_match");
  assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger(), []).outcome, "not_found");
  assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger(), [normalized(), normalized({ providerCheckoutId: secondProviderCheckoutId })]).outcome, "ambiguous");
  const invalid: Partial<LemonSqueezyRetrievedCheckout>[] = [
    { testMode: false }, { storeId: "11" }, { variantId: "21" },
    { customSalonId: "20000000-0000-4000-8000-000000000002" },
    { customPlanCode: "starter" },
    { customIdempotencyKey: "30000000-0000-4000-8000-000000000002" },
    { providerCreatedAt: "2026-07-31T09:00:00.000Z" },
    { providerCheckoutId: " " },
  ];
  for (const override of invalid) assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger(), [normalized(override)]).outcome, "invalid_candidate");
  assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger({ environment: "live" }), [normalized()]).outcome, "invalid_candidate");
  assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger(), [normalized({ customCheckoutSessionId: null })]).outcome, "not_found");
  assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger(), [normalized({ customCheckoutSessionId: "10000000-0000-4000-8000-000000000002" })]).outcome, "not_found");
  assert.equal(correlateLemonSqueezyCheckoutCandidates(ledger({ knownProviderCheckoutIds: new Set([providerCheckoutId]) }), [normalized()]).outcome, "invalid_candidate");
});

test("page correlation distinguishes page miss from definitive search result", () => {
  assert.equal(correlateLemonSqueezyCheckoutPage(ledger(), { checkouts: [], nextPageUrl: "next" }).outcome, "page_not_found");
});

test("pagination continues after page miss and finds a later exact candidate", async () => {
  const pages = new Map<string, LemonSqueezyCheckoutPage>([
    [pageUrl(1), { checkouts: [normalized({ providerCheckoutId: secondProviderCheckoutId, customCheckoutSessionId: null, providerCreatedAt: "2026-07-31T10:02:00.000Z" })], nextPageUrl: pageUrl(2) }],
    [pageUrl(2), { checkouts: [normalized()], nextPageUrl: null }],
  ]);
  const result = await searchLemonSqueezyCheckoutPages({ ledger: ledger(), firstPageUrl: pageUrl(1), fetchPage: async (url) => pages.get(url)! });
  assert.equal(result.outcome, "exact_match");
});

test("pagination validates the trusted first page before fetching", async () => {
  let calls = 0;
  const fetchPage = async (): Promise<LemonSqueezyCheckoutPage> => {
    calls += 1;
    return { checkouts: [], nextPageUrl: null };
  };
  for (const firstPageUrl of [
    pageUrl(1).replace("api.lemonsqueezy.com", "evil.invalid"),
    pageUrl(1).replace("/v1/checkouts", "/v1/subscriptions"),
    pageUrl(1, "11"),
    pageUrl(1, "10", "21"),
  ]) {
    await invalidResponse(() => searchLemonSqueezyCheckoutPages({ ledger: ledger(), firstPageUrl, fetchPage }));
  }
  assert.equal(calls, 0);
  assert.equal((await searchLemonSqueezyCheckoutPages({ ledger: ledger(), firstPageUrl: pageUrl(1), fetchPage })).outcome, "search_exhausted_not_found");
  assert.equal(calls, 1);
});

test("pagination stops safely once newest-first results are older than the recovery window", async () => {
  let calls = 0;
  const old = new Date(Date.parse(createdAt) - CHECKOUT_RECOVERY_WINDOW_BEFORE_MS - 1).toISOString();
  const result = await searchLemonSqueezyCheckoutPages({
    ledger: ledger(), firstPageUrl: pageUrl(1),
    fetchPage: async () => { calls += 1; return { checkouts: [normalized({ customCheckoutSessionId: null, providerCreatedAt: old, providerUpdatedAt: old })], nextPageUrl: pageUrl(2) }; },
  });
  assert.equal(result.outcome, "search_exhausted_not_found");
  assert.equal(calls, 1);
});

test("pagination limit is not treated as provider not-found", async () => {
  const result = await searchLemonSqueezyCheckoutPages({
    ledger: ledger(), firstPageUrl: pageUrl(1), maxPages: 2,
    fetchPage: async (url) => ({ checkouts: [], nextPageUrl: url === pageUrl(1) ? pageUrl(2) : pageUrl(3) }),
  });
  assert.equal(result.outcome, "pagination_limit_reached");
});

test("live client accepts only live-mode response", async () => {
  const client = new LemonSqueezyCheckoutRetrievalClient(liveConfig, async () => Response.json(payload({ attributes: { test_mode: false } }), { headers: jsonApiHeaders }));
  assert.equal((await client.retrieveById(providerCheckoutId)).testMode, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { LemonSqueezyPlanChangeProvider, PLAN_CHANGE_MAX_RESPONSE_BYTES } from "./lemonSqueezyPlanChangeProvider.ts";
import { subscriptionPayload } from "./planChangeTestFixtures.ts";

const config = { environment: "test" as const, apiKey: "test-api-key-not-real", storeId: "501229" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/vnd.api+json" } });

function recordingFetch(respond: (call: { url: string; init: RequestInit }) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("GET uses the fixed host, no redirects, and returns a validated snapshot with the payment processor", async () => {
  const { calls, fetchImpl } = recordingFetch(() => json(subscriptionPayload()));
  const result = await new LemonSqueezyPlanChangeProvider(config, fetchImpl).readSubscription("2618348");
  assert.equal(result.kind, "snapshot");
  assert.equal(calls[0].url, "https://api.lemonsqueezy.com/v1/subscriptions/2618348");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  if (result.kind === "snapshot") {
    assert.equal(result.snapshot.paymentProcessor, "stripe");
    assert.equal(result.snapshot.providerVariantId, "2264918");
    assert.equal(JSON.stringify(result.snapshot).includes("private@example.invalid"), false);
    assert.equal(JSON.stringify(result.snapshot).includes("signature"), false);
  }
});

test("GET refuses foreign, mismatched or malformed subscriptions as unavailable", async () => {
  for (const payload of [
    subscriptionPayload({ store_id: 440512 }),
    subscriptionPayload({ test_mode: false }),
    subscriptionPayload({}, "999"),
    subscriptionPayload({ renews_at: "not-a-date" }),
    { data: { type: "orders", id: "2618348", attributes: {} } },
  ]) {
    const { fetchImpl } = recordingFetch(() => json(payload));
    assert.deepEqual(await new LemonSqueezyPlanChangeProvider(config, fetchImpl).readSubscription("2618348"), { kind: "unavailable" });
  }
  const { calls, fetchImpl } = recordingFetch(() => json(subscriptionPayload()));
  assert.deepEqual(await new LemonSqueezyPlanChangeProvider(config, fetchImpl).readSubscription("../x"), { kind: "unavailable" });
  assert.equal(calls.length, 0, "invalid id never reaches the network");
});

test("PATCH sends exactly variant_id + disable_prorations, never invoice_immediately, and never follows redirects", async () => {
  const { calls, fetchImpl } = recordingFetch(() => json(subscriptionPayload({ variant_id: 2264940 })));
  const result = await new LemonSqueezyPlanChangeProvider(config, fetchImpl).patchVariant("2618348", "2264940");
  assert.equal(result.kind, "accepted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.redirect, "error");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body, { data: { type: "subscriptions", id: "2618348", attributes: { variant_id: 2264940, disable_prorations: true } } });
  assert.equal(String(calls[0].init.body).includes("invoice_immediately"), false);
});

test("every non-accepted PATCH outcome is ambiguous (no proven rejection allowlist)", async () => {
  const cases: [string, () => Response | Promise<Response>][] = [
    ["429", () => json({ errors: [] }, 429)],
    ["500", () => json({ errors: [] }, 500)],
    ["503", () => json({ errors: [] }, 503)],
    ["422", () => json({ errors: [{ status: "422" }] }, 422)],
    ["404", () => json({ errors: [] }, 404)],
    ["redirect", () => { throw new TypeError("redirect mode is set to error"); }],
    ["transport", () => { throw new TypeError("fetch failed"); }],
    ["invalid json", () => new Response("{not json", { status: 200 })],
    ["foreign subscription", () => json(subscriptionPayload({}, "1"))],
    ["foreign store", () => json(subscriptionPayload({ store_id: 1 }))],
    ["too large", () => new Response("x".repeat(PLAN_CHANGE_MAX_RESPONSE_BYTES + 1), { status: 200 })],
  ];
  for (const [label, respond] of cases) {
    const { calls, fetchImpl } = recordingFetch(respond);
    assert.deepEqual(await new LemonSqueezyPlanChangeProvider(config, fetchImpl).patchVariant("2618348", "2264940"), { kind: "ambiguous" }, label);
    assert.equal(calls.length, 1, `${label}: single dispatch, no retry`);
  }
});

test("a PATCH that times out is ambiguous and is not retried", async () => {
  const { calls, fetchImpl } = recordingFetch(({ init }) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const result = await new LemonSqueezyPlanChangeProvider(config, fetchImpl, 20).patchVariant("2618348", "2264940");
  assert.deepEqual(result, { kind: "ambiguous" });
  assert.equal(calls.length, 1);
});

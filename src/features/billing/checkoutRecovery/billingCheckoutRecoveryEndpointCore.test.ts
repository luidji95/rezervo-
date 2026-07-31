import assert from "node:assert/strict";
import test from "node:test";

import { BillingCheckoutRecoveryConfigError } from "./billingCheckoutRecoveryConfig.ts";
import { handleBillingCheckoutRecoveryRequest } from "./billingCheckoutRecoveryEndpointCore.ts";

const id = "10000000-0000-4000-8000-000000000001";
const config = {
  enabled: true as const, environment: "test" as const, secret: "recovery-secret",
  leaseSeconds: 300, pageSize: 50, maxPages: 5,
  provider: { provider: "lemonsqueezy" as const, environment: "test" as const, apiKey: "private", storeId: "10" },
};
function request(body: unknown = { checkoutSessionId: id }, authorization = "Bearer recovery-secret", contentType = "application/json") {
  return new Request("https://rezervo.test/api/internal/billing/recover-checkout/test", {
    method: "POST", headers: { Authorization: authorization, "Content-Type": contentType }, body: JSON.stringify(body),
  });
}
function run(req: Request, overrides: Partial<Parameters<typeof handleBillingCheckoutRecoveryRequest>[0]> = {}) {
  return handleBillingCheckoutRecoveryRequest({ request: req, getConfig: () => config, runRecovery: async () => "still_pending", ...overrides });
}

test("disabled config is sanitized and auth failures are 401", async () => {
  const disabled = await run(request(), { getConfig: () => { throw new BillingCheckoutRecoveryConfigError(); } });
  assert.deepEqual(disabled.body, { success: false, outcome: "configuration_error" }); assert.equal(disabled.status, 503);
  for (const authorization of ["", "secret", "bearer recovery-secret", "Bearer  recovery-secret", "Bearer recovery-secret extra", "Bearer recovery-secret, Bearer recovery-secret", "Bearer wrong", "Basic recovery-secret"]) {
    const response = await run(request(undefined, authorization));
    assert.equal(response.status, 401); assert.deepEqual(response.body, { success: false, outcome: "unauthorized" });
  }
});

test("unexpected config resolver failures use HTTP-only internal_error", async () => {
  const response = await run(request(), { getConfig: () => { throw new Error("private config detail"); } });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { success: false, outcome: "internal_error" });
  assert.equal(JSON.stringify(response).includes("private"), false);
});

test("whitespace-only configured secrets never authenticate", async () => {
  const response = await run(request(undefined, "Bearer secret"), { getConfig: () => ({ ...config, secret: "   " }) });
  assert.equal(response.status, 401);
});

test("body accepts only one internal UUID field and JSON", async () => {
  for (const [body, type] of [
    [{ checkoutSessionId: "bad" }, "application/json"],
    [{ checkoutSessionId: id, environment: "live" }, "application/json"],
    [{ checkoutSessionId: id, outcome: "still_pending" }, "application/json"],
    [{ checkoutSessionId: id }, "text/plain"],
  ] as const) {
    const response = await run(request(body, "Bearer recovery-secret", type));
    assert.equal(response.status, 400); assert.deepEqual(response.body, { success: false, outcome: "invalid_request" });
  }
});

test("every recovery outcome has an explicit HTTP success matrix", async () => {
  for (const [outcome, status, success] of [
    ["already_open", 200, true], ["already_completed", 200, true], ["still_pending", 200, true],
    ["provider_not_found", 200, false], ["invalid_candidate", 200, false], ["ambiguous", 200, false],
    ["pagination_limit_reached", 200, false], ["manual_review", 200, false], ["invalid_provider_response", 200, false],
    ["already_claimed", 409, false], ["claim_lost", 409, false],
    ["provider_unavailable", 503, false], ["configuration_error", 503, false],
  ] as const) {
    const response = await run(request(), { runRecovery: async () => outcome });
    assert.equal(response.status, status); assert.deepEqual(response.body, { success, outcome });
    const serialized = JSON.stringify(response);
    for (const privateValue of [id, "private", "recovery-secret", "checkoutUrl", "providerCheckoutId"]) assert.equal(serialized.includes(privateValue), false);
  }
});

test("unexpected server failures use HTTP-only internal_error", async () => {
  const response = await run(request(), { runRecovery: async () => { throw new Error("private SQL detail"); } });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { success: false, outcome: "internal_error" });
  assert.deepEqual(Object.keys(response.body).sort(), ["outcome", "success"]);
  assert.equal(JSON.stringify(response).includes("private"), false);
});

function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  });
  return new Request("https://rezervo.test/api/internal/billing/recover-checkout/test", {
    method: "POST", headers: { Authorization: "Bearer recovery-secret", "Content-Type": "application/json", ...headers },
    body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("body size is enforced from Content-Length before recovery", async () => {
  let calls = 0;
  for (const length of ["513", "01", "1.0", "-1", " 10"] ) {
    const response = await run(streamRequest([new TextEncoder().encode("{}")], { "Content-Length": length }), { runRecovery: async () => { calls += 1; return "still_pending"; } });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test("chunked and multibyte bodies stop once 512 bytes are exceeded", async () => {
  let calls = 0;
  for (const chunks of [
    [new Uint8Array(300), new Uint8Array(213)],
    [new TextEncoder().encode(`{"checkoutSessionId":"${id}","x":"${"č".repeat(260)}"}`)],
  ]) {
    const response = await run(streamRequest(chunks), { runRecovery: async () => { calls += 1; return "still_pending"; } });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

function failingStreamRequest(afterChunk: boolean) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (afterChunk) controller.enqueue(new TextEncoder().encode("{"));
      controller.error(new Error("private stream detail"));
    },
  });
  return new Request("https://rezervo.test/api/internal/billing/recover-checkout/test", {
    method: "POST",
    headers: { Authorization: "Bearer recovery-secret", "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("errored request streams are sanitized invalid requests before recovery", async () => {
  let calls = 0;
  for (const afterChunk of [false, true]) {
    const response = await run(failingStreamRequest(afterChunk), {
      runRecovery: async () => { calls += 1; return "still_pending"; },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { success: false, outcome: "invalid_request" });
    assert.equal(JSON.stringify(response).includes("private"), false);
  }
  assert.equal(calls, 0);
});

test("exact boundary is read safely while valid small JSON runs recovery", async () => {
  let calls = 0;
  const valid = JSON.stringify({ checkoutSessionId: id });
  const exact = `${valid}${" ".repeat(512 - new TextEncoder().encode(valid).byteLength)}`;
  for (const body of [exact, valid]) {
    const response = await run(streamRequest([new TextEncoder().encode(body)]), { runRecovery: async () => { calls += 1; return "still_pending"; } });
    assert.equal(response.status, 200);
  }
  assert.equal(calls, 2);
});

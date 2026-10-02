import assert from "node:assert/strict";
import test from "node:test";
import { handleBillingWebhookRetryRequest } from "./billingWebhookRetryEndpointCore.ts";
import { BillingWebhookRetryWorkerConfigError } from "./billingWebhookRetryWorkerConfig.ts";

const summary = { claimed: 4, processed: 2, alreadyTerminal: 1, retried: 1, manualReview: 0, claimLost: 0 };
const config = { enabled: true as const, environment: "test" as const, secret: "worker-secret", batchSize: 10 };
function request(input: { authorization?: string; body?: string; query?: string } = {}) { return new Request(`https://rezervo.test/api/internal/billing/process-pending${input.query ?? ""}`, { method: "POST", headers: input.authorization ? { Authorization: input.authorization } : {}, ...(input.body === undefined ? {} : { body: input.body }) }); }
async function run(req: Request, overrides: Partial<Parameters<typeof handleBillingWebhookRetryRequest>[0]> = {}) { return handleBillingWebhookRetryRequest({ request: req, getConfig: () => config, runWorker: async () => summary, ...overrides }); }

test("disabled or unconfigured worker returns no-store 503", async () => {
  const result = await run(request(), { getConfig: () => { throw new BillingWebhookRetryWorkerConfigError("BILLING_WORKER_DISABLED"); } });
  assert.equal(result.status, 503); assert.deepEqual(result.body, { success: false, code: "BILLING_WORKER_DISABLED" }); assert.equal(result.headers["Cache-Control"], "no-store");
});

test("missing, malformed, wrong and ordinary user bearer tokens are unauthorized", async () => {
  for (const authorization of [undefined, "worker-secret", "Basic worker-secret", "Bearer wrong", "Bearer supabase-access-token"]) {
    const result = await run(request({ authorization })); assert.equal(result.status, 401); assert.deepEqual(result.body, { success: false, code: "BILLING_WORKER_UNAUTHORIZED" }); assert.equal(result.headers["Cache-Control"], "no-store");
  }
});

test("test and live worker secrets cannot authenticate the opposite trusted route", async () => {
  const testConfig = { enabled: true as const, secret: "test-secret", batchSize: 10, environment: "test" as const };
  const liveConfig = { enabled: true as const, secret: "live-secret", batchSize: 5, environment: "live" as const };

  const liveWithTestSecret = await run(request({ authorization: "Bearer test-secret" }), {
    getConfig: () => liveConfig,
  });
  const testWithLiveSecret = await run(request({ authorization: "Bearer live-secret" }), {
    getConfig: () => testConfig,
  });

  assert.equal(liveWithTestSecret.status, 401);
  assert.deepEqual(liveWithTestSecret.body, { success: false, code: "BILLING_WORKER_UNAUTHORIZED" });
  assert.equal(testWithLiveSecret.status, 401);
  assert.deepEqual(testWithLiveSecret.body, { success: false, code: "BILLING_WORKER_UNAUTHORIZED" });
});

test("non-empty body and any query are rejected before worker execution", async () => {
  let called = false;
  for (const req of [request({ authorization: "Bearer worker-secret", body: "{}" }), request({ authorization: "Bearer worker-secret", query: "?event=private" })]) {
    const result = await run(req, { runWorker: async () => { called = true; return summary; } }); assert.equal(result.status, 400); assert.deepEqual(result.body, { success: false, code: "BILLING_WORKER_REQUEST_INVALID" });
  }
  assert.equal(called, false);
});

test("valid internal request returns only aggregate summary and no-store", async () => {
  const result = await run(request({ authorization: "Bearer worker-secret" }));
  assert.equal(result.status, 200); assert.deepEqual(result.body, { success: true, summary }); assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(JSON.stringify(result).includes("eventId"), false); assert.equal(JSON.stringify(result).includes("worker-secret"), false);
});

test("worker failure is sanitized", async () => {
  const result = await run(request({ authorization: "Bearer worker-secret" }), { runWorker: async () => { throw new Error("private SQL and event details"); } });
  assert.equal(result.status, 500); assert.deepEqual(result.body, { success: false, code: "BILLING_WORKER_INTERNAL_ERROR" }); assert.equal(JSON.stringify(result).includes("private"), false);
});

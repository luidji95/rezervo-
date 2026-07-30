import assert from "node:assert/strict";
import test from "node:test";
import { BillingWebhookRetryWorkerConfigError, getBillingWebhookRetryWorkerConfig, verifyBillingWorkerAuthorization } from "./billingWebhookRetryWorkerConfig.ts";

const testBase = { BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "test", BILLING_WORKER_ENABLED: "true", BILLING_WORKER_SECRET: "test-secret" };
const liveBase = { BILLING_PROVIDER: "lemonsqueezy", BILLING_ENVIRONMENT: "live", BILLING_LIVE_WORKER_ENABLED: "true", BILLING_LIVE_WORKER_SECRET: "live-secret" };

test("test and live worker configs use only their dedicated capability and secret", () => {
  assert.deepEqual(getBillingWebhookRetryWorkerConfig("test", testBase), { enabled: true, environment: "test", secret: "test-secret", batchSize: 10 });
  assert.deepEqual(getBillingWebhookRetryWorkerConfig("live", liveBase), { enabled: true, environment: "live", secret: "live-secret", batchSize: 5 });
  for (const [trusted, environment] of [
    ["test", { ...testBase, BILLING_WORKER_ENABLED: "false" }],
    ["test", { ...testBase, BILLING_WORKER_SECRET: undefined }],
    ["live", { ...liveBase, BILLING_LIVE_WORKER_ENABLED: "false" }],
    ["live", { ...liveBase, BILLING_LIVE_WORKER_SECRET: undefined }],
  ] as const) {
    assert.throws(() => getBillingWebhookRetryWorkerConfig(trusted, environment), (error: unknown) => error instanceof BillingWebhookRetryWorkerConfigError);
  }
});

test("batch sizes use isolated safe defaults and accept only one through twenty", () => {
  assert.equal(getBillingWebhookRetryWorkerConfig("test", testBase).batchSize, 10);
  assert.equal(getBillingWebhookRetryWorkerConfig("live", liveBase).batchSize, 5);
  assert.equal(getBillingWebhookRetryWorkerConfig("test", { ...testBase, BILLING_WORKER_BATCH_SIZE: "20" }).batchSize, 20);
  assert.equal(getBillingWebhookRetryWorkerConfig("live", { ...liveBase, BILLING_LIVE_WORKER_BATCH_SIZE: "2" }).batchSize, 2);
  for (const value of ["0", "21", "1.5", "invalid"]) {
    assert.equal(getBillingWebhookRetryWorkerConfig("test", { ...testBase, BILLING_WORKER_BATCH_SIZE: value }).batchSize, 10);
    assert.equal(getBillingWebhookRetryWorkerConfig("live", { ...liveBase, BILLING_LIVE_WORKER_BATCH_SIZE: value }).batchSize, 5);
  }
});

test("deployment authority and secrets never fall back across environments", () => {
  for (const action of [
    () => getBillingWebhookRetryWorkerConfig("live", { ...testBase, BILLING_LIVE_WORKER_ENABLED: "true" }),
    () => getBillingWebhookRetryWorkerConfig("test", { ...liveBase, BILLING_WORKER_ENABLED: "true" }),
    () => getBillingWebhookRetryWorkerConfig("live", { ...liveBase, BILLING_LIVE_WORKER_SECRET: undefined, BILLING_WORKER_SECRET: "test-secret" }),
    () => getBillingWebhookRetryWorkerConfig("test", { ...testBase, BILLING_WORKER_SECRET: undefined, BILLING_LIVE_WORKER_SECRET: "live-secret" }),
    () => getBillingWebhookRetryWorkerConfig("test", { ...testBase, BILLING_ENVIRONMENT: undefined, NODE_ENV: "test", VERCEL_ENV: "preview" }),
  ]) assert.throws(action, BillingWebhookRetryWorkerConfigError);
});

test("authorization uses exact Bearer secret and rejects malformed or user tokens", () => {
  assert.equal(verifyBillingWorkerAuthorization("Bearer strong-worker-secret", "strong-worker-secret"), true);
  for (const value of [null, "", "strong-worker-secret", "Basic strong-worker-secret", "Bearer wrong", "Bearer supabase-user-access-token"]) assert.equal(verifyBillingWorkerAuthorization(value, "strong-worker-secret"), false);
});

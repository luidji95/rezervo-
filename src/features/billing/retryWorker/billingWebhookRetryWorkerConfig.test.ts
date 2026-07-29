import assert from "node:assert/strict";
import test from "node:test";
import { BillingWebhookRetryWorkerConfigError, getBillingWebhookRetryWorkerConfig, verifyBillingWorkerAuthorization } from "./billingWebhookRetryWorkerConfig.ts";

test("worker config fails closed for missing flag, false flag and missing secret", () => {
  for (const environment of [{}, { BILLING_WORKER_ENABLED: "false", BILLING_WORKER_SECRET: "secret" }, { BILLING_WORKER_ENABLED: "true" }]) {
    assert.throws(() => getBillingWebhookRetryWorkerConfig(environment), (error: unknown) => error instanceof BillingWebhookRetryWorkerConfigError);
  }
});

test("batch size defaults to ten and accepts only one through twenty", () => {
  const base = { BILLING_WORKER_ENABLED: "true", BILLING_WORKER_SECRET: "secret" };
  assert.equal(getBillingWebhookRetryWorkerConfig(base).batchSize, 10);
  assert.equal(getBillingWebhookRetryWorkerConfig({ ...base, BILLING_WORKER_BATCH_SIZE: "20" }).batchSize, 20);
  for (const value of ["0", "21", "1.5", "invalid"]) assert.equal(getBillingWebhookRetryWorkerConfig({ ...base, BILLING_WORKER_BATCH_SIZE: value }).batchSize, 10);
});

test("authorization uses exact Bearer secret and rejects malformed or user tokens", () => {
  assert.equal(verifyBillingWorkerAuthorization("Bearer strong-worker-secret", "strong-worker-secret"), true);
  for (const value of [null, "", "strong-worker-secret", "Basic strong-worker-secret", "Bearer wrong", "Bearer supabase-user-access-token"]) assert.equal(verifyBillingWorkerAuthorization(value, "strong-worker-secret"), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  handleReminderCronRequest,
  parseReminderCronBatchSize,
  verifyReminderCronBearerAuth,
} from "./reminderCronEndpointCore.ts";

const secret = "cron-test-secret";

function workerResult(overrides: Record<string, number> = {}) {
  return {
    claimed: 1,
    processed: 1,
    accepted: 1,
    retryScheduled: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    items: [{ deliveryId: "private-id", outcome: "accepted" as const, providerMessageId: "private-provider-id" }],
    ...overrides,
  };
}

test("requires the dedicated timing-safe Bearer secret", () => {
  assert.equal(verifyReminderCronBearerAuth({ authorization: null, configuredSecret: secret }), false);
  assert.equal(verifyReminderCronBearerAuth({ authorization: "Bearer wrong", configuredSecret: secret }), false);
  assert.equal(verifyReminderCronBearerAuth({ authorization: `Bearer ${secret}`, configuredSecret: secret }), true);
  assert.equal(verifyReminderCronBearerAuth({ authorization: "Bearer dev-admin", configuredSecret: secret }), false);
});

test("runtime disabled is an authenticated no-op", async () => {
  let calls = 0;
  const result = await handleReminderCronRequest({
    authorization: `Bearer ${secret}`,
    configuredSecret: secret,
    runtimeEnabled: false,
    providerAndDatabaseConfigured: false,
    runWorker: async () => {
      calls += 1;
      return workerResult();
    },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { status: "runtime_disabled", claimed: 0, processed: 0 });
  assert.equal(calls, 0);
});

test("uses bounded server configuration and excludes item details", async () => {
  const observed: number[] = [];
  const result = await handleReminderCronRequest({
    authorization: `Bearer ${secret}`,
    configuredSecret: secret,
    runtimeEnabled: true,
    batchSizeValue: "99",
    providerAndDatabaseConfigured: true,
    runWorker: async (batchSize) => {
      observed.push(batchSize);
      return workerResult({ failed: 1, accepted: 0 });
    },
  });
  assert.deepEqual(observed, [20]);
  assert.equal(result.statusCode, 200);
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /deliveryId|providerMessageId|private-id|recipient|api.?key/i);
});

test("batch parsing defaults and clamps without throwing", () => {
  assert.equal(parseReminderCronBatchSize(undefined), 5);
  assert.equal(parseReminderCronBatchSize("invalid"), 5);
  assert.equal(parseReminderCronBatchSize("0"), 1);
  assert.equal(parseReminderCronBatchSize("21"), 20);
  assert.equal(parseReminderCronBatchSize("7"), 7);
});

test("configuration and transient worker errors are controlled", async () => {
  const base = {
    authorization: `Bearer ${secret}`,
    configuredSecret: secret,
    runtimeEnabled: true,
    runWorker: async () => workerResult(),
  };
  assert.equal((await handleReminderCronRequest({ ...base, providerAndDatabaseConfigured: false })).statusCode, 503);
  assert.equal((await handleReminderCronRequest({
    ...base,
    providerAndDatabaseConfigured: true,
    runWorker: async () => { throw new Error("sensitive stack"); },
  })).statusCode, 500);
});

test("unauthorized requests never call the worker or expose secrets", async () => {
  let calls = 0;
  const result = await handleReminderCronRequest({
    authorization: "Bearer wrong",
    configuredSecret: secret,
    runtimeEnabled: true,
    providerAndDatabaseConfigured: true,
    runWorker: async () => {
      calls += 1;
      return workerResult();
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.statusCode, 401);
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(secret));
});

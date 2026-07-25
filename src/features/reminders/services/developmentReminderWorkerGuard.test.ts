import assert from "node:assert/strict";
import test from "node:test";
import { validateDevelopmentSendGuard, validateDevelopmentWorkerAccess } from "./developmentReminderWorkerGuard.ts";

test("development worker requires development, configured secret and exact Bearer token", () => {
  assert.equal(validateDevelopmentWorkerAccess({ nodeEnv: "production", configuredSecret: "secret", authorization: "Bearer secret" }).allowed, false);
  assert.equal(validateDevelopmentWorkerAccess({ nodeEnv: "development", authorization: "Bearer secret" }).allowed, false);
  assert.equal(validateDevelopmentWorkerAccess({ nodeEnv: "development", configuredSecret: "secret", authorization: "Bearer wrong" }).allowed, false);
  assert.equal(validateDevelopmentWorkerAccess({ nodeEnv: "development", configuredSecret: "secret", authorization: "Bearer secret" }).allowed, true);
});

test("send guard requires batch one, explicit flag and test recipient", () => {
  assert.equal(validateDevelopmentSendGuard({ mode: "send", batchSize: 2, allowSend: "true", testRecipient: "+381641234567" }).allowed, false);
  assert.equal(validateDevelopmentSendGuard({ mode: "send", batchSize: 1, allowSend: "false", testRecipient: "+381641234567" }).allowed, false);
  assert.equal(validateDevelopmentSendGuard({ mode: "send", batchSize: 1, allowSend: "true" }).allowed, false);
  assert.equal(validateDevelopmentSendGuard({ mode: "send", batchSize: 1, allowSend: "true", testRecipient: "+381641234567" }).allowed, true);
  assert.equal(validateDevelopmentSendGuard({ mode: "dry_run", batchSize: 5 }).allowed, true);
});

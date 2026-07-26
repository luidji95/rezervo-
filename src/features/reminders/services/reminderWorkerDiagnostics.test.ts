import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySupabaseClaimError,
  normalizeWorkerError,
  ReminderWorkerStageError,
  sanitizeWorkerErrorText,
} from "./reminderWorkerDiagnostics.ts";

test("normalizes function-not-found and permission Supabase errors", () => {
  const missing = normalizeWorkerError(classifySupabaseClaimError({
    code: "PGRST202",
    message: "Could not find public.claim_due_appointment_reminders in the schema cache",
  }));
  assert.equal(missing.stage, "claim_rpc");
  assert.equal(missing.code, "PGRST202");
  assert.equal(missing.name, "SupabaseRpcError");
  assert.match(missing.safeMessage, /signature|schema cache/i);

  const denied = normalizeWorkerError(classifySupabaseClaimError({
    code: "42501",
    message: "permission denied for function",
  }));
  assert.equal(denied.stage, "claim_rpc");
  assert.equal(denied.code, "42501");
  assert.match(denied.safeMessage, /permission/i);
});

test("normalizes JavaScript, string and object errors", () => {
  assert.deepEqual(normalizeWorkerError(new Error("plain failure"), "worker_processing"), {
    stage: "worker_processing",
    code: "REMINDER_WORKER_FAILED",
    name: "Error",
    safeMessage: "plain failure",
  });
  assert.equal(normalizeWorkerError("string failure").safeMessage, "string failure");
  assert.deepEqual(normalizeWorkerError({ code: "CUSTOM_1", name: "ObjectError", message: "object failure" }), {
    stage: "unknown",
    code: "CUSTOM_1",
    name: "ObjectError",
    safeMessage: "object failure",
  });
});

test("sanitizes explicit secrets, auth values, tokens and phone numbers", () => {
  const secret = "very-secret-value";
  const result = sanitizeWorkerErrorText(
    `key=${secret} Authorization: Bearer token-value phone +381641234567`,
    [secret],
  );
  assert.doesNotMatch(result, /very-secret-value|token-value|\+381641234567/);
  assert.match(result, /\[REDACTED\]|\[REDACTED_AUTH\]|\*{5}/);
});

test("preserves an explicit safe stage error and bounds unsafe strings", () => {
  const normalized = normalizeWorkerError(new ReminderWorkerStageError({
    stage: "provider_initialization",
    code: "PROVIDER_INIT_FAILED",
    safeMessage: "x".repeat(500),
  }));
  assert.equal(normalized.stage, "provider_initialization");
  assert.equal(normalized.safeMessage.length, 240);
});

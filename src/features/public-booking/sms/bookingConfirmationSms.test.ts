import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import type { SmsSendInput, SmsSendResult } from "../../reminders/types/smsProvider.ts";
import { buildBookingConfirmationSms, toSmsAscii } from "./bookingConfirmationSmsTemplate.ts";
import { classifySmsResult, sendBookingConfirmationSmsCore, type BookingConfirmationSmsDependencies } from "./bookingConfirmationSmsCore.ts";

const token = randomBytes(32).toString("base64url");
const input = { appointmentId: "a1", salonName: "Studio Šarm Đurđa", salonTimezone: "Europe/Belgrade", appointmentStart: "2026-11-09T08:00:00.000Z", recipientE164: "+381641112222", manageToken: token };

function deps(overrides: Partial<BookingConfirmationSmsDependencies> = {}, result: SmsSendResult = { outcome: "accepted", provider: "infobip", providerMessageId: "m1", httpStatus: 200 }) {
  const calls = { reserve: [] as string[][], finish: [] as unknown[], sent: [] as SmsSendInput[] };
  const base: BookingConfirmationSmsDependencies = {
    config: { enabled: true, allowedRecipients: new Set(["+381641112222"]), hashKey: "k".repeat(40), appUrl: "https://app.example.test" },
    hmac: (key, value) => createHmac("sha256", key).update(value).digest("hex"),
    reserve: async (...args) => { calls.reserve.push(args); return "reserved"; },
    finish: async (value) => { calls.finish.push(value); return true; },
    provider: { send: async (message) => { calls.sent.push(message); return result; } },
  };
  return { calls, dependencies: { ...base, ...overrides } };
}

test("template: salon, date, time and link; GSM-7 friendly", () => {
  const text = buildBookingConfirmationSms({ salonName: "Studio Šarm Đurđa", appointmentStart: "2026-11-09T08:00:00.000Z", salonTimezone: "Europe/Belgrade", manageLink: "https://app.example.test/manage-booking#abc" });
  assert.equal(text, "Termin u salonu Studio Sarm Djurdja je potvrdjen za 9. novembra u 09:00. Pregled i otkazivanje: https://app.example.test/manage-booking#abc");
  assert.equal(toSmsAscii("čćšžđ ČĆŠŽĐ"), "ccszdj CCSZDj");
});

test("accepted: one send with the link for this token, outcome recorded without the number or text", async () => {
  const { calls, dependencies } = deps();
  assert.deepEqual(await sendBookingConfirmationSmsCore(input, dependencies), { outcome: "accepted", errorCode: null });
  assert.equal(calls.sent.length, 1);
  assert.ok(calls.sent[0].text.endsWith(`https://app.example.test/manage-booking#${token}`));
  assert.equal(calls.reserve[0][1], createHmac("sha256", "k".repeat(40)).update("+381641112222").digest("hex"));
  assert.deepEqual(calls.finish[0], { appointmentId: "a1", provider: "infobip", status: "accepted", providerMessageId: "m1", errorCode: null });
  assert.ok(!JSON.stringify(calls.finish).includes("+381") && !JSON.stringify(calls.finish).includes(token));
});

test("switches, allow list and configuration stop before reserving", async () => {
  for (const [config, outcome] of [
    [{ enabled: false }, "disabled"],
    [{ allowedRecipients: new Set<string>() }, "not_allowed"],
    [{ allowedRecipients: new Set(["+381649999999"]) }, "not_allowed"],
    [{ hashKey: "short" }, "misconfigured"],
    [{ hashKey: null }, "misconfigured"],
    [{ appUrl: "https://app.example.test/path" }, "misconfigured"],
  ] as const) {
    const base = deps();
    const { calls, dependencies } = deps({ config: { ...base.dependencies.config, ...config } });
    assert.equal((await sendBookingConfirmationSmsCore(input, dependencies)).outcome, outcome);
    assert.equal(calls.reserve.length + calls.sent.length, 0, outcome);
  }
  const { calls, dependencies } = deps();
  assert.equal((await sendBookingConfirmationSmsCore({ ...input, manageToken: "short" }, dependencies)).outcome, "invalid_input");
  assert.equal(calls.reserve.length, 0);
});

test("reservation refusals never send", async () => {
  for (const outcome of ["already_reserved", "not_eligible", "salon_disabled", "recipient_limit", "salon_limit"]) {
    const { calls, dependencies } = deps({ reserve: async () => outcome });
    assert.equal((await sendBookingConfirmationSmsCore(input, dependencies)).outcome, outcome);
    assert.equal(calls.sent.length, 0);
  }
  const { calls, dependencies } = deps({ reserve: async () => { throw new Error("db"); } });
  assert.deepEqual(await sendBookingConfirmationSmsCore(input, dependencies), { outcome: "error", errorCode: "RESERVE_FAILED" });
  assert.equal(calls.sent.length, 0);
});

test("provider outcomes: rejected vs unknown, one attempt only", async () => {
  const cases: [SmsSendResult, string][] = [
    [{ outcome: "permanent_error", provider: "infobip", acceptanceCertainty: "not_accepted", httpStatus: 400, safeMessage: "x" }, "rejected"],
    [{ outcome: "retryable_error", provider: "infobip", acceptanceCertainty: "not_accepted", httpStatus: 429, safeMessage: "x" }, "rejected"],
    [{ outcome: "retryable_error", provider: "infobip", acceptanceCertainty: "unknown", errorCode: "PROVIDER_TIMEOUT", safeMessage: "x" }, "unknown"],
    [{ outcome: "retryable_error", provider: "infobip", acceptanceCertainty: "unknown", httpStatus: 503, safeMessage: "x" }, "unknown"],
  ];
  for (const [result, status] of cases) {
    const { calls, dependencies } = deps({}, result);
    assert.equal((await sendBookingConfirmationSmsCore(input, dependencies)).outcome, status);
    assert.equal(calls.sent.length, 1, "no retry");
  }
  const { calls, dependencies } = deps({ provider: { send: async () => { throw new Error("boom"); } } });
  assert.deepEqual(await sendBookingConfirmationSmsCore(input, dependencies), { outcome: "unknown", errorCode: "SEND_EXCEPTION" });
  assert.equal((calls.finish[0] as { status: string }).status, "unknown");
  assert.equal(classifySmsResult({ outcome: "permanent_error", provider: "infobip", acceptanceCertainty: "not_accepted", errorCode: "bad code with spaces", safeMessage: "x" }).errorCode, null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import type { SmsSendInput, SmsSendResult } from "../../reminders/types/smsProvider.ts";
import { buildBookingConfirmationSms, toSmsAscii } from "./bookingConfirmationSmsTemplate.ts";
import { classifySmsResult, isBookingConfirmationSmsLive, parseRecipientMode, sendBookingConfirmationSmsCore, type BookingConfirmationSmsDependencies } from "./bookingConfirmationSmsCore.ts";

const token = randomBytes(32).toString("base64url");
const input = { appointmentId: "a1", salonName: "Studio Šarm Đurđa", salonTimezone: "Europe/Belgrade", appointmentStart: "2026-11-09T08:00:00.000Z", recipientE164: "+381641112222", manageToken: token };

function deps(overrides: Partial<BookingConfirmationSmsDependencies> = {}, result: SmsSendResult = { outcome: "accepted", provider: "infobip", providerMessageId: "m1", httpStatus: 200 }) {
  const calls = { reserve: [] as string[][], finish: [] as unknown[], sent: [] as SmsSendInput[], options: [] as string[] };
  const base: BookingConfirmationSmsDependencies = {
    config: { enabled: true, recipientMode: "allowlist", allowedRecipients: new Set(["+381641112222"]), hashKey: "k".repeat(40), appUrl: "https://app.example.test" },
    hmac: (key, value) => createHmac("sha256", key).update(value).digest("hex"),
    reserve: async (...args) => { calls.reserve.push(args); return "reserved"; },
    finish: async (value) => { calls.finish.push(value); return true; },
    loadMessageOptions: async (appointmentId) => { calls.options.push(appointmentId); return { style: null, templateSet: "universal" }; },
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

test("recipient mode: unset, empty and allowlist keep the list; only the exact value any opens it; anything else is invalid", () => {
  for (const raw of [undefined, "", "  ", "allowlist", " allowlist "]) assert.equal(parseRecipientMode(raw), "allowlist", String(raw));
  assert.equal(parseRecipientMode("any"), "any");
  assert.equal(parseRecipientMode(" any "), "any");
  for (const raw of ["ANY", "Any", "all", "true", "1", "*", "any,allowlist", "allow_list", "anyone", "\"any\""]) assert.equal(parseRecipientMode(raw), "invalid", raw);
});

test("recipient mode any: a number not on the list is sent (empty list too), still through the reservation", async () => {
  for (const allowedRecipients of [new Set<string>(), new Set(["+381649999999"])]) {
    const base = deps();
    const { calls, dependencies } = deps({ config: { ...base.dependencies.config, recipientMode: "any", allowedRecipients } });
    assert.deepEqual(await sendBookingConfirmationSmsCore(input, dependencies), { outcome: "accepted", errorCode: null });
    assert.equal(calls.reserve.length, 1);
    assert.equal(calls.sent.length, 1);
  }
  // The salon switch and the limits are enforced by the reservation in any mode.
  for (const outcome of ["salon_disabled", "recipient_limit", "salon_limit"]) {
    const base = deps();
    const { calls, dependencies } = deps({ config: { ...base.dependencies.config, recipientMode: "any" }, reserve: async () => outcome });
    assert.equal((await sendBookingConfirmationSmsCore(input, dependencies)).outcome, outcome);
    assert.equal(calls.sent.length, 0);
  }
  // Global switch and configuration checks still apply.
  for (const [config, outcome] of [[{ enabled: false }, "disabled"], [{ hashKey: null }, "misconfigured"], [{ appUrl: null }, "misconfigured"]] as const) {
    const base = deps();
    const { calls, dependencies } = deps({ config: { ...base.dependencies.config, recipientMode: "any", ...config } });
    assert.equal((await sendBookingConfirmationSmsCore(input, dependencies)).outcome, outcome);
    assert.equal(calls.reserve.length + calls.sent.length, 0);
  }
});

test("recipient mode invalid: nothing is sent even to a listed number", async () => {
  const base = deps();
  const { calls, dependencies } = deps({ config: { ...base.dependencies.config, recipientMode: "invalid" } });
  assert.equal((await sendBookingConfirmationSmsCore(input, dependencies)).outcome, "misconfigured");
  assert.equal(calls.reserve.length + calls.sent.length, 0);
});

test("reservation refusals never send", async () => {
  for (const outcome of ["already_reserved", "not_eligible", "salon_disabled", "not_entitled", "recipient_limit", "salon_limit"]) {
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

test("global switch is live for owners only when enabled, open to every number and fully configured", () => {
  const config = { enabled: true, recipientMode: "any" as const, allowedRecipients: new Set<string>(), hashKey: "k".repeat(40), appUrl: "https://rezervo.example" };
  assert.equal(isBookingConfirmationSmsLive(config), true);
  assert.equal(isBookingConfirmationSmsLive({ ...config, enabled: false }), false);
  assert.equal(isBookingConfirmationSmsLive({ ...config, recipientMode: "allowlist" }), false);
  assert.equal(isBookingConfirmationSmsLive({ ...config, recipientMode: "invalid" }), false);
  assert.equal(isBookingConfirmationSmsLive({ ...config, hashKey: "short" }), false);
  assert.equal(isBookingConfirmationSmsLive({ ...config, appUrl: null }), false);
  assert.equal(isBookingConfirmationSmsLive({ ...config, appUrl: "https://rezervo.example/path" }), false);
});

test("style: read after the reservation; a failed read sends the standard message; refusals never read it", async () => {
  const standard = `Termin u salonu Studio Sarm Djurdja je potvrdjen za 9. novembra u 09:00. Pregled i otkazivanje: https://app.example.test/manage-booking#${token}`;
  const plain = deps();
  await sendBookingConfirmationSmsCore(input, plain.dependencies);
  assert.equal(plain.calls.sent[0].text, standard);
  assert.deepEqual(plain.calls.options, ["a1"]);

  const failing = deps({ loadMessageOptions: async () => { throw new Error("db"); } });
  assert.deepEqual(await sendBookingConfirmationSmsCore(input, failing.dependencies), { outcome: "accepted", errorCode: null });
  assert.equal(failing.calls.sent[0].text, standard);

  const refused = deps({ reserve: async () => "already_reserved" });
  assert.equal((await sendBookingConfirmationSmsCore(input, refused.dependencies)).outcome, "already_reserved");
  assert.equal(refused.calls.options.length + refused.calls.sent.length, 0);
});

test("style: chosen set and variation by appointment id, link intact, same text when processed again", async () => {
  const link = `https://app.example.test/manage-booking#${token}`;
  for (const [style, templateSet] of [["business", "universal"], ["casual", "universal"], ["playful", "haircut"], ["playful", "coloring"], ["playful", "massage"], ["playful", "universal"]] as const) {
    const texts = [] as string[];
    for (let run = 0; run < 2; run += 1) {
      const { calls, dependencies } = deps({ loadMessageOptions: async () => ({ style, templateSet }) });
      await sendBookingConfirmationSmsCore(input, dependencies);
      texts.push(calls.sent[0].text);
    }
    assert.equal(texts[0], texts[1]);
    assert.ok(texts[0].endsWith(` ${link}`), texts[0]);
    assert.ok(texts[0].includes("Studio Sarm Djurdja") && texts[0].includes("9. novembra") && texts[0].includes("09:00"), texts[0]);
  }
});

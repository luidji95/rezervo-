import assert from "node:assert/strict";
import test from "node:test";
import { MAX_INFOBIP_DELIVERY_RESULTS, parseInfobipSmsDeliveryReport } from "./infobipDeliveryReportParser.ts";

const validResult = {
  messageId: "provider-message-1",
  status: { id: 5, groupId: 3, groupName: "DELIVERED", name: "DELIVERED_TO_HANDSET", description: "ignored" },
  error: { id: 0, name: "NO_ERROR", groupName: "OK", permanent: false },
  sentAt: "2026-07-25T13:00:00.000+0000",
  doneAt: "2026-07-25T13:00:03.000+0000",
  to: "+381641234567",
  price: { pricePerMessage: 1 },
};

test("rejects missing results and oversized batches while accepting an empty batch", () => {
  assert.deepEqual(parseInfobipSmsDeliveryReport({}), { ok: false, code: "INVALID_PAYLOAD" });
  assert.deepEqual(parseInfobipSmsDeliveryReport({ results: Array(MAX_INFOBIP_DELIVERY_RESULTS + 1).fill(validResult) }), { ok: false, code: "BATCH_TOO_LARGE" });
  assert.deepEqual(parseInfobipSmsDeliveryReport({ results: [] }), { ok: true, received: 0, invalid: 0, items: [] });
});

test("normalizes one or multiple reports and ignores unknown fields", () => {
  const parsed = parseInfobipSmsDeliveryReport({ results: [validResult, { ...validResult, messageId: "provider-message-2", unknown: "ignored" }] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.received, 2);
  assert.equal(parsed.items[0].statusGroup, "DELIVERED");
  assert.equal(parsed.items[0].providerDoneAt, "2026-07-25T13:00:03.000Z");
  const serialized = JSON.stringify(parsed.items[0]);
  assert.equal(serialized.includes("+381641234567"), false);
  assert.equal(serialized.includes("description"), false);
  assert.equal(serialized.includes("price"), false);
});

test("isolates invalid dates and message IDs without rejecting valid batch items", () => {
  const parsed = parseInfobipSmsDeliveryReport({ results: [
    validResult,
    { ...validResult, messageId: "" },
    { ...validResult, doneAt: "not-a-date" },
    { ...validResult, messageId: "x".repeat(257) },
  ] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.received, 4);
  assert.equal(parsed.invalid, 3);
  assert.equal(parsed.items.length, 1);
});

test("supports optional status, error and doneAt fields", () => {
  const parsed = parseInfobipSmsDeliveryReport({ results: [{ messageId: "message", status: { groupName: "PENDING" } }] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.items[0], {
    providerMessageId: "message", statusId: null, statusGroup: "PENDING", statusName: null,
    errorCode: null, errorName: null, errorPermanent: null, providerDoneAt: null,
  });
});

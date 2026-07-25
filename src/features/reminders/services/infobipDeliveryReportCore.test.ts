import assert from "node:assert/strict";
import test from "node:test";
import type { InfobipDeliveryReportItem } from "../types/infobipDeliveryReport.ts";
import { mapInfobipDeliveryTransition, processInfobipDeliveryReportBatch } from "./infobipDeliveryReportCore.ts";
import { countsTowardReminderQuota } from "./reminderUsagePolicy.ts";

const item: InfobipDeliveryReportItem = {
  providerMessageId: "message-1", statusId: 5, statusGroup: "DELIVERED",
  statusName: "DELIVERED_TO_HANDSET", errorCode: "0", errorName: "NO_ERROR",
  errorPermanent: false, providerDoneAt: "2026-07-25T13:00:03.000Z",
};

test("maps delivered, pending and final failure groups monotonically", () => {
  assert.deepEqual(mapInfobipDeliveryTransition({ status: "sent", providerDoneAt: null }, item), { action: "updated", status: "delivered" });
  for (const group of ["PENDING", "UNKNOWN"]) {
    assert.equal(mapInfobipDeliveryTransition({ status: "sent", providerDoneAt: null }, { ...item, statusGroup: group }).status, "sent");
  }
  for (const group of ["UNDELIVERABLE", "EXPIRED", "REJECTED"]) {
    assert.equal(mapInfobipDeliveryTransition({ status: "sent", providerDoneAt: null }, { ...item, statusGroup: group }).status, "failed");
  }
  assert.deepEqual(mapInfobipDeliveryTransition({ status: "delivered", providerDoneAt: item.providerDoneAt }, { ...item, statusGroup: "PENDING" }), { action: "ignored_monotone", status: "delivered" });
  assert.equal(mapInfobipDeliveryTransition({ status: "delivered", providerDoneAt: null }, { ...item, statusGroup: "REJECTED" }).status, "delivered");
});

test("older reliable reports cannot overwrite newer reports", () => {
  const result = mapInfobipDeliveryTransition(
    { status: "sent", providerDoneAt: "2026-07-25T13:00:05.000Z" },
    { ...item, providerDoneAt: "2026-07-25T13:00:03.000Z" },
  );
  assert.equal(result.action, "ignored_stale");
});

test("batch continues across invalid and unknown messages and surfaces DB failures", async () => {
  const result = await processInfobipDeliveryReportBatch({
    received: 3, invalid: 1, items: [item, { ...item, providerMessageId: "unknown" }],
    apply: async (entry) => entry.providerMessageId === "unknown" ? "ignored_unknown_message" : "updated",
  });
  assert.deepEqual(result, { received: 3, updated: 1, ignored: 2, invalid: 1 });
  await assert.rejects(() => processInfobipDeliveryReportBatch({
    received: 1, invalid: 0, items: [item], apply: async () => { throw new Error("DB_UNAVAILABLE"); },
  }), /DB_UNAVAILABLE/);
});

test("quota counts provider acceptance independently of later delivery status", () => {
  for (const status of ["sent", "delivered", "failed"]) {
    assert.equal(countsTowardReminderQuota({ sentAt: "2026-07-25T13:00:00Z", providerMessageId: `message-${status}` }), true);
  }
  assert.equal(countsTowardReminderQuota({ sentAt: null, providerMessageId: null }), false);
  assert.equal(countsTowardReminderQuota({ sentAt: null, providerMessageId: "pre-send-failed" }), false);
  assert.equal(countsTowardReminderQuota({ sentAt: "2026-07-25T13:00:00Z", providerMessageId: null }), false);
});

test("duplicate delivery reports do not change quota cardinality", () => {
  const acceptedRows = new Map<string, { sentAt: string | null; providerMessageId: string | null }>();
  acceptedRows.set("message-1", { sentAt: "2026-07-25T13:00:00Z", providerMessageId: "message-1" });
  acceptedRows.set("message-1", { sentAt: "2026-07-25T13:00:00Z", providerMessageId: "message-1" });
  assert.equal([...acceptedRows.values()].filter(countsTowardReminderQuota).length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { claimDueAppointmentRemindersCore, parseReminderClaimResponse } from "./reminderClaimCore.ts";
import { normalizeWorkerError } from "./reminderWorkerDiagnostics.ts";

const validRow = {
  delivery_id: "delivery-id",
  salon_id: "salon-id",
  appointment_id: "appointment-id",
  client_id: null,
  channel: "sms",
  scheduled_for: "2026-07-26T10:00:00.000Z",
  appointment_start: "2026-07-26T11:00:00.000Z",
  recipient: "+381641234567",
  salon_timezone: "Europe/Belgrade",
  attempt_count: 1,
  lease_expires_at: "2026-07-26T10:10:00.000Z",
  claim_token: "claim-token",
};

test("extracts safe Supabase claim RPC errors", async () => {
  for (const providerError of [
    { code: "PGRST202", message: "function missing from schema cache" },
    { code: "42501", message: "permission denied" },
    { code: "PGRST204", message: "signature mismatch" },
    { code: "22023", message: "SQL exception" },
  ]) {
    await assert.rejects(
      () => claimDueAppointmentRemindersCore({
        client: { rpc: async () => ({ data: null, error: providerError }) },
        batchSize: 5,
        now: new Date("2026-07-26T10:00:00.000Z"),
        leaseMinutes: 10,
      }),
      (error) => {
        const normalized = normalizeWorkerError(error);
        assert.equal(normalized.stage, "claim_rpc");
        assert.equal(normalized.code, providerError.code);
        return true;
      },
    );
  }
});

test("marks thrown RPC requests and invalid responses by stage", async () => {
  await assert.rejects(
    () => claimDueAppointmentRemindersCore({
      client: { rpc: async () => { throw new Error("network"); } },
      batchSize: 5,
      now: new Date(),
      leaseMinutes: 10,
    }),
    (error) => normalizeWorkerError(error).stage === "claim_rpc",
  );

  for (const data of [null, {}, [null], [{ ...validRow, claim_token: null }]]) {
    assert.throws(
      () => parseReminderClaimResponse(data),
      (error) => {
        const normalized = normalizeWorkerError(error);
        return normalized.stage === "claim_response" && normalized.code === "INVALID_CLAIM_RESPONSE";
      },
    );
  }
});

test("maps a valid response without changing the claim contract", async () => {
  const result = await claimDueAppointmentRemindersCore({
    client: { rpc: async () => ({ data: [validRow], error: null }) },
    batchSize: 5,
    now: new Date("2026-07-26T10:00:00.000Z"),
    leaseMinutes: 10,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].deliveryId, "delivery-id");
  assert.equal(result[0].claimToken, "claim-token");
});

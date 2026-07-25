import assert from "node:assert/strict";
import test from "node:test";
import type { SmsSendResult } from "../types/smsProvider.ts";
import type { ReminderClaim } from "../types/reminders.ts";
import type { ReminderFinalizationInput, ValidatedReminderClaim } from "./reminderDeliveryService.ts";
import { getReminderRetryDelayMinutes, runReminderWorkerCore, type ReminderWorkerDependencies } from "./reminderWorkerCore.ts";

const now = new Date("2026-07-25T10:00:00.000Z");
const claim: ReminderClaim = {
  deliveryId: "delivery-1", salonId: "salon-1", appointmentId: "appointment-1",
  clientId: "client-1", channel: "sms", scheduledFor: "2026-07-25T09:00:00.000Z",
  appointmentStart: "2026-07-26T12:00:00.000Z", recipient: "+381641234567",
  salonTimezone: "Europe/Belgrade", attemptCount: 1,
  leaseExpiresAt: "2026-07-25T10:10:00.000Z", claimToken: "token-1",
};
const validation: ValidatedReminderClaim = {
  valid: true, reason: "ELIGIBLE", deliveryId: claim.deliveryId, salonId: claim.salonId,
  appointmentId: claim.appointmentId, recipient: claim.recipient,
  appointmentStart: claim.appointmentStart, salonTimezone: claim.salonTimezone,
  salonName: "Studio Ana", serviceName: "Šišanje", attemptCount: 1, maxAttempts: 3,
};

function dependencies(options: {
  claims?: ReminderClaim[];
  validation?: ValidatedReminderClaim;
  providerResult?: SmsSendResult;
  providerThrows?: boolean;
  validationThrowsFor?: string;
  finalizeResult?: boolean;
  recoveryResult?: boolean;
  recipientAllowed?: (recipient: string) => boolean;
} = {}) {
  const finalizations: ReminderFinalizationInput[] = [];
  let providerCalls = 0;
  const deps: ReminderWorkerDependencies = {
    claim: async () => options.claims ?? [claim],
    validate: async (item) => {
      if (item.deliveryId === options.validationThrowsFor) throw new Error("DB_FAILED");
      return options.validation ?? validation;
    },
    finalize: async (input) => { finalizations.push(input); return options.finalizeResult ?? true; },
    recoverAccepted: async () => options.recoveryResult ?? false,
    provider: {
      send: async () => {
        providerCalls += 1;
        if (options.providerThrows) throw new Error("UNEXPECTED_PROVIDER_THROW");
        return options.providerResult ?? {
          outcome: "accepted", provider: "infobip", providerMessageId: "provider-1",
          providerStatusGroup: "PENDING", providerStatusName: "PENDING_ACCEPTED", httpStatus: 200,
        };
      },
    },
    now: () => new Date(now),
    recipientAllowed: options.recipientAllowed,
  };
  return { deps, finalizations, providerCalls: () => providerCalls };
}

test("handles empty, one and multiple-item batches", async () => {
  const empty = dependencies({ claims: [] });
  assert.deepEqual(await runReminderWorkerCore(5, empty.deps), {
    claimed: 0, processed: 0, accepted: 0, retryScheduled: 0,
    failed: 0, cancelled: 0, skipped: 0, items: [],
  });

  const one = dependencies();
  const oneResult = await runReminderWorkerCore(1, one.deps);
  assert.equal(oneResult.accepted, 1);
  assert.equal(one.finalizations[0].outcome, "sent");
  assert.equal(one.finalizations[0].providerMessageId, "provider-1");

  const second = { ...claim, deliveryId: "delivery-2", claimToken: "token-2" };
  const multiple = dependencies({ claims: [claim, second], validationThrowsFor: "delivery-1" });
  const multipleResult = await runReminderWorkerCore(2, multiple.deps);
  assert.equal(multipleResult.processed, 2);
  assert.equal(multipleResult.failed, 1);
  assert.equal(multipleResult.accepted, 1);
});

test("validates batch size", async () => {
  const setup = dependencies();
  for (const invalid of [0, 101, 1.5]) {
    await assert.rejects(() => runReminderWorkerCore(invalid, setup.deps), /INVALID_BATCH_SIZE/);
  }
});

test("does not call provider after any final validation cancellation", async () => {
  for (const reason of [
    "APPOINTMENT_CANCELLED", "APPOINTMENT_STATUS_CHANGED", "APPOINTMENT_RESCHEDULED",
    "APPOINTMENT_IN_PAST", "ENTITLEMENT_REQUIRED", "REMINDERS_DISABLED",
    "SUBSCRIPTION_INACTIVE", "CLAIM_EXPIRED",
  ]) {
    const setup = dependencies({ validation: { ...validation, valid: false, reason, recipient: null } });
    const result = await runReminderWorkerCore(1, setup.deps);
    assert.equal(result.cancelled, 1);
    assert.equal(result.items[0].errorCode, reason);
    assert.equal(setup.providerCalls(), 0);
  }
});

test("development recipient guard cancels without provider call", async () => {
  const setup = dependencies({ recipientAllowed: () => false });
  const result = await runReminderWorkerCore(1, setup.deps);
  assert.equal(result.items[0].errorCode, "TEST_RECIPIENT_NOT_ALLOWED");
  assert.equal(setup.providerCalls(), 0);
  assert.equal(setup.finalizations[0].outcome, "cancelled");
});

test("schedules only confirmed not-accepted retries with 5 and 15 minute backoff", async () => {
  assert.equal(getReminderRetryDelayMinutes(1), 5);
  assert.equal(getReminderRetryDelayMinutes(2), 15);
  assert.equal(getReminderRetryDelayMinutes(3), null);
  for (const [attemptCount, expectedMinutes] of [[1, 5], [2, 15]] as const) {
    const setup = dependencies({
      validation: { ...validation, attemptCount },
      providerResult: {
        outcome: "retryable_error", provider: "infobip", acceptanceCertainty: "not_accepted",
        errorCode: "RATE_LIMITED", safeMessage: "Pokušajte kasnije.", retryAfterSeconds: 10,
      },
    });
    const result = await runReminderWorkerCore(1, setup.deps);
    assert.equal(result.retryScheduled, 1);
    assert.equal(setup.finalizations[0].outcome, "retry_scheduled");
    assert.equal(setup.finalizations[0].nextRetryAt?.getTime(), now.getTime() + expectedMinutes * 60_000);
  }
});

test("max attempts and permanent errors finalize failed without retry", async () => {
  const maxed = dependencies({
    validation: { ...validation, attemptCount: 3, maxAttempts: 3 },
    providerResult: { outcome: "retryable_error", provider: "infobip", acceptanceCertainty: "not_accepted", safeMessage: "Busy" },
  });
  assert.equal((await runReminderWorkerCore(1, maxed.deps)).items[0].errorCode, "MAX_ATTEMPTS_REACHED");
  assert.equal(maxed.finalizations[0].outcome, "failed");

  for (const errorCode of ["INVALID_RECIPIENT", "HTTP_400", "HTTP_401", "HTTP_403", "PROVIDER_REJECTED"]) {
    const setup = dependencies({
      providerResult: { outcome: "permanent_error", provider: "infobip", acceptanceCertainty: "not_accepted", errorCode, safeMessage: "Zahtev je odbijen." },
    });
    const result = await runReminderWorkerCore(1, setup.deps);
    assert.equal(result.failed, 1);
    assert.equal(setup.finalizations[0].outcome, "failed");
  }
});

test("unknown provider acceptance never schedules retry", async () => {
  for (const errorCode of ["PROVIDER_TIMEOUT", "PROVIDER_NETWORK_ERROR", "HTTP_500", "AMBIGUOUS_PROVIDER_RESPONSE"]) {
    const setup = dependencies({
      providerResult: { outcome: "retryable_error", provider: "infobip", acceptanceCertainty: "unknown", errorCode, safeMessage: "Ishod nije poznat." },
    });
    const result = await runReminderWorkerCore(1, setup.deps);
    assert.equal(result.retryScheduled, 0);
    assert.equal(result.items[0].errorCode, "PROVIDER_OUTCOME_UNKNOWN");
    assert.equal(setup.finalizations[0].outcome, "failed");
  }
});

test("reports accepted-provider DB finalization failure and never sends twice", async () => {
  const setup = dependencies({ finalizeResult: false });
  const result = await runReminderWorkerCore(1, setup.deps);
  assert.equal(result.items[0].errorCode, "PROVIDER_ACCEPTED_DB_FINALIZATION_FAILED");
  assert.equal(result.items[0].providerMessageId, "provider-1");
  assert.equal(setup.providerCalls(), 1);
});

test("recovers an accepted provider result without sending a second SMS", async () => {
  const setup = dependencies({ finalizeResult: false, recoveryResult: true });
  const result = await runReminderWorkerCore(1, setup.deps);
  assert.equal(result.accepted, 1);
  assert.equal(result.items[0].providerMessageId, "provider-1");
  assert.equal(setup.providerCalls(), 1);
});

test("results never expose recipient, API key, Authorization header or raw payload", async () => {
  const setup = dependencies({
    providerResult: {
      outcome: "permanent_error", provider: "infobip", acceptanceCertainty: "not_accepted",
      errorCode: "PROVIDER_REJECTED", safeMessage: "Bezbedna poruka.",
    },
  });
  const serialized = JSON.stringify(await runReminderWorkerCore(1, setup.deps));
  assert.equal(serialized.includes(claim.recipient), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes("API_KEY"), false);
  assert.equal(serialized.includes("raw"), false);
});

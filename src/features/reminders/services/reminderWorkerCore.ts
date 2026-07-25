import type { SmsProvider } from "../types/smsProvider.ts";
import type { ReminderClaim } from "../types/reminders.ts";
import { buildAppointmentReminderSms } from "./appointmentReminderTemplate.ts";
import type { ReminderFinalizationInput, ValidatedReminderClaim } from "./reminderDeliveryService.ts";

export type ReminderWorkerItemResult = {
  deliveryId: string;
  outcome: "accepted" | "retry_scheduled" | "failed" | "cancelled" | "skipped";
  errorCode?: string;
  providerMessageId?: string;
};

export type ReminderWorkerRunResult = {
  claimed: number;
  processed: number;
  accepted: number;
  retryScheduled: number;
  failed: number;
  cancelled: number;
  skipped: number;
  items: ReminderWorkerItemResult[];
};

export type ReminderWorkerDependencies = {
  claim(batchSize: number, now: Date): Promise<ReminderClaim[]>;
  validate(claim: ReminderClaim, now: Date): Promise<ValidatedReminderClaim>;
  finalize(input: ReminderFinalizationInput): Promise<boolean>;
  recoverAccepted?(input: { deliveryId: string; claimToken: string; provider: string; providerMessageId: string; sentAt: Date }): Promise<boolean>;
  provider: SmsProvider;
  now(): Date;
  recipientAllowed?(recipient: string): boolean;
};

export function getReminderRetryDelayMinutes(attemptCount: number) {
  if (attemptCount === 1) return 5;
  if (attemptCount === 2) return 15;
  return null;
}

function summarize(items: ReminderWorkerItemResult[], claimed: number): ReminderWorkerRunResult {
  return {
    claimed,
    processed: items.length,
    accepted: items.filter((item) => item.outcome === "accepted").length,
    retryScheduled: items.filter((item) => item.outcome === "retry_scheduled").length,
    failed: items.filter((item) => item.outcome === "failed").length,
    cancelled: items.filter((item) => item.outcome === "cancelled").length,
    skipped: items.filter((item) => item.outcome === "skipped").length,
    items,
  };
}

async function safeFinalize(dependencies: ReminderWorkerDependencies, input: ReminderFinalizationInput) {
  try {
    return await dependencies.finalize(input);
  } catch {
    return false;
  }
}

export async function runReminderWorkerCore(
  batchSize: number,
  dependencies: ReminderWorkerDependencies,
): Promise<ReminderWorkerRunResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("INVALID_BATCH_SIZE");
  const runNow = dependencies.now();
  const claims = await dependencies.claim(batchSize, runNow);
  const items: ReminderWorkerItemResult[] = [];

  for (const claim of claims) {
    try {
      const validation = await dependencies.validate(claim, dependencies.now());
      if (!validation.valid || !validation.recipient || !validation.appointmentStart || !validation.salonTimezone || !validation.salonName) {
        items.push({ deliveryId: claim.deliveryId, outcome: "cancelled", errorCode: validation.reason });
        continue;
      }

      if (dependencies.recipientAllowed && !dependencies.recipientAllowed(validation.recipient)) {
        await safeFinalize(dependencies, {
          deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome: "cancelled",
          now: dependencies.now(), errorCode: "TEST_RECIPIENT_NOT_ALLOWED",
        });
        items.push({ deliveryId: claim.deliveryId, outcome: "cancelled", errorCode: "TEST_RECIPIENT_NOT_ALLOWED" });
        continue;
      }

      const text = buildAppointmentReminderSms({
        salonName: validation.salonName,
        appointmentStart: validation.appointmentStart,
        salonTimezone: validation.salonTimezone,
        serviceName: validation.serviceName,
        now: dependencies.now(),
      });
      const providerResult = await dependencies.provider.send({
        recipient: validation.recipient,
        text,
        clientReference: claim.deliveryId,
      });

      if (providerResult.outcome === "accepted") {
        let finalized = await safeFinalize(dependencies, {
          deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome: "sent",
          now: dependencies.now(), provider: providerResult.provider,
          providerMessageId: providerResult.providerMessageId,
        });
        if (!finalized && dependencies.recoverAccepted) {
          try {
            finalized = await dependencies.recoverAccepted({
              deliveryId: claim.deliveryId,
              claimToken: claim.claimToken,
              provider: providerResult.provider,
              providerMessageId: providerResult.providerMessageId,
              sentAt: dependencies.now(),
            });
          } catch {
            finalized = false;
          }
        }
        items.push(finalized
          ? { deliveryId: claim.deliveryId, outcome: "accepted", providerMessageId: providerResult.providerMessageId }
          : { deliveryId: claim.deliveryId, outcome: "failed", errorCode: "PROVIDER_ACCEPTED_DB_FINALIZATION_FAILED", providerMessageId: providerResult.providerMessageId });
        continue;
      }

      const attemptCount = validation.attemptCount ?? claim.attemptCount;
      const maxAttempts = validation.maxAttempts ?? 3;
      if (providerResult.outcome === "retryable_error" && providerResult.acceptanceCertainty === "not_accepted" && attemptCount < maxAttempts) {
        const delayMinutes = getReminderRetryDelayMinutes(attemptCount);
        if (delayMinutes !== null) {
          const retrySeconds = Math.max(delayMinutes * 60, providerResult.retryAfterSeconds ?? 0);
          const finalized = await safeFinalize(dependencies, {
            deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome: "retry_scheduled",
            now: dependencies.now(), nextRetryAt: new Date(dependencies.now().getTime() + retrySeconds * 1000),
            errorCode: providerResult.errorCode ?? "PROVIDER_RETRYABLE_ERROR",
            errorMessage: providerResult.safeMessage,
          });
          items.push(finalized
            ? { deliveryId: claim.deliveryId, outcome: "retry_scheduled", errorCode: providerResult.errorCode }
            : { deliveryId: claim.deliveryId, outcome: "failed", errorCode: "REMINDER_FINALIZATION_FAILED" });
          continue;
        }
      }

      const unknown = providerResult.outcome === "retryable_error" && providerResult.acceptanceCertainty === "unknown";
      const errorCode = unknown ? "PROVIDER_OUTCOME_UNKNOWN"
        : attemptCount >= maxAttempts ? "MAX_ATTEMPTS_REACHED"
          : providerResult.errorCode ?? "PROVIDER_PERMANENT_ERROR";
      const finalized = await safeFinalize(dependencies, {
        deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome: "failed",
        now: dependencies.now(), errorCode, errorMessage: providerResult.safeMessage,
      });
      items.push(finalized
        ? { deliveryId: claim.deliveryId, outcome: "failed", errorCode }
        : { deliveryId: claim.deliveryId, outcome: "failed", errorCode: "REMINDER_FINALIZATION_FAILED" });
    } catch {
      await safeFinalize(dependencies, {
        deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome: "failed",
        now: dependencies.now(), errorCode: "REMINDER_ITEM_PROCESSING_FAILED",
        errorMessage: "Kontrolisana greška tokom obrade reminder stavke.",
      });
      items.push({ deliveryId: claim.deliveryId, outcome: "failed", errorCode: "REMINDER_ITEM_PROCESSING_FAILED" });
    }
  }

  return summarize(items, claims.length);
}

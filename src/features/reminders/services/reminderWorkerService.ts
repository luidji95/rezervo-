import "server-only";
import { claimDueAppointmentReminders } from "./reminderClaimService";
import { finalizeClaimedReminderDelivery, recoverAcceptedReminderDelivery, validateClaimedReminderForSend } from "./reminderDeliveryService";
import { runReminderWorkerCore, type ReminderWorkerRunResult } from "./reminderWorkerCore";
import { getSmsProvider } from "../providers/smsProviderFactory";
import { normalizeWorkerError, ReminderWorkerStageError } from "./reminderWorkerDiagnostics";

export async function runReminderWorker(input: {
  batchSize?: number;
  allowedRecipient?: string;
} = {}): Promise<ReminderWorkerRunResult> {
  const batchSize = input.batchSize ?? 50;
  let provider;
  try {
    provider = getSmsProvider();
  } catch (error) {
    throw new ReminderWorkerStageError({
      stage: "provider_initialization",
      code: "SMS_PROVIDER_INITIALIZATION_FAILED",
      name: "SmsProviderInitializationError",
      safeMessage: "SMS provider could not be initialized.",
      cause: error,
    });
  }

  try {
    return await runReminderWorkerCore(batchSize, {
      claim: (size, now) => claimDueAppointmentReminders({ batchSize: size, now }),
      validate: (claim, now) => validateClaimedReminderForSend(claim.deliveryId, claim.claimToken, now),
      finalize: finalizeClaimedReminderDelivery,
      recoverAccepted: recoverAcceptedReminderDelivery,
      provider,
      now: () => new Date(),
      recipientAllowed: input.allowedRecipient === undefined
        ? undefined
        : (recipient) => recipient === input.allowedRecipient,
    });
  } catch (error) {
    const normalized = normalizeWorkerError(error, "worker_processing");
    if (error instanceof ReminderWorkerStageError) throw error;
    throw new ReminderWorkerStageError({ ...normalized, cause: error });
  }
}

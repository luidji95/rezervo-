import "server-only";
import { claimDueAppointmentReminders } from "./reminderClaimService";
import { finalizeClaimedReminderDelivery, recoverAcceptedReminderDelivery, validateClaimedReminderForSend } from "./reminderDeliveryService";
import { runReminderWorkerCore, type ReminderWorkerRunResult } from "./reminderWorkerCore";
import { getSmsProvider } from "../providers/smsProviderFactory";

export async function runReminderWorker(input: {
  batchSize?: number;
  allowedRecipient?: string;
} = {}): Promise<ReminderWorkerRunResult> {
  const batchSize = input.batchSize ?? 50;
  return runReminderWorkerCore(batchSize, {
    claim: (size, now) => claimDueAppointmentReminders({ batchSize: size, now }),
    validate: (claim, now) => validateClaimedReminderForSend(claim.deliveryId, claim.claimToken, now),
    finalize: finalizeClaimedReminderDelivery,
    recoverAccepted: recoverAcceptedReminderDelivery,
    provider: getSmsProvider(),
    now: () => new Date(),
    recipientAllowed: input.allowedRecipient === undefined
      ? undefined
      : (recipient) => recipient === input.allowedRecipient,
  });
}

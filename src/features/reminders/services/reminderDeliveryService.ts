import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";

export type ValidatedReminderClaim = {
  valid: boolean;
  reason: string;
  deliveryId: string;
  salonId: string | null;
  appointmentId: string | null;
  recipient: string | null;
  appointmentStart: string | null;
  salonTimezone: string | null;
  salonName: string | null;
  serviceName: string | null;
  attemptCount: number | null;
  maxAttempts: number | null;
};

type ValidationRow = {
  is_valid: boolean; reason: string; delivery_id: string; salon_id: string | null;
  appointment_id: string | null; recipient: string | null; appointment_start: string | null;
  salon_timezone: string | null; salon_name: string | null; service_name: string | null;
  attempt_count: number | null; max_attempts: number | null;
};

export async function validateClaimedReminderForSend(deliveryId: string, claimToken: string, now: Date): Promise<ValidatedReminderClaim> {
  const { data, error } = await supabaseServer.rpc("validate_claimed_reminder_for_send", {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_now: now.toISOString(),
  });
  const row = ((data ?? []) as ValidationRow[])[0];
  if (error || !row) throw new Error("REMINDER_VALIDATION_FAILED");
  return {
    valid: row.is_valid, reason: row.reason, deliveryId: row.delivery_id,
    salonId: row.salon_id, appointmentId: row.appointment_id, recipient: row.recipient,
    appointmentStart: row.appointment_start, salonTimezone: row.salon_timezone,
    salonName: row.salon_name, serviceName: row.service_name,
    attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
  };
}

export type ReminderFinalizationInput = {
  deliveryId: string;
  claimToken: string;
  outcome: "sent" | "retry_scheduled" | "failed" | "cancelled";
  now: Date;
  provider?: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  nextRetryAt?: Date;
};

export async function finalizeClaimedReminderDelivery(input: ReminderFinalizationInput) {
  const { data, error } = await supabaseServer.rpc("finalize_claimed_reminder_delivery", {
    p_delivery_id: input.deliveryId,
    p_claim_token: input.claimToken,
    p_outcome: input.outcome,
    p_now: input.now.toISOString(),
    p_provider: input.provider ?? null,
    p_provider_message_id: input.providerMessageId ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage?.slice(0, 1000) ?? null,
    p_next_retry_at: input.nextRetryAt?.toISOString() ?? null,
  });
  if (error) throw new Error("REMINDER_FINALIZATION_FAILED");
  return data === true;
}

export async function recoverAcceptedReminderDelivery(input: {
  deliveryId: string;
  claimToken: string;
  provider: string;
  providerMessageId: string;
  sentAt: Date;
}) {
  const { data, error } = await supabaseServer.rpc("recover_accepted_reminder_delivery", {
    p_delivery_id: input.deliveryId,
    p_claim_token: input.claimToken,
    p_provider: input.provider,
    p_provider_message_id: input.providerMessageId,
    p_sent_at: input.sentAt.toISOString(),
  });
  if (error) return false;
  return data === true;
}

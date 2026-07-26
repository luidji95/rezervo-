import type { ReminderClaim } from "../types/reminders.ts";
import { classifySupabaseClaimError, ReminderWorkerStageError } from "./reminderWorkerDiagnostics.ts";

type ClaimRow = {
  delivery_id: string;
  salon_id: string;
  appointment_id: string;
  client_id: string | null;
  channel: "sms" | "viber";
  scheduled_for: string;
  appointment_start: string;
  recipient: string;
  salon_timezone: string;
  attempt_count: number;
  lease_expires_at: string;
  claim_token: string;
};

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isClaimRow(value: unknown): value is ClaimRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return isNonEmptyString(row.delivery_id)
    && isNonEmptyString(row.salon_id)
    && isNonEmptyString(row.appointment_id)
    && (row.client_id === null || isNonEmptyString(row.client_id))
    && (row.channel === "sms" || row.channel === "viber")
    && isNonEmptyString(row.scheduled_for)
    && isNonEmptyString(row.appointment_start)
    && isNonEmptyString(row.recipient)
    && isNonEmptyString(row.salon_timezone)
    && Number.isInteger(row.attempt_count)
    && isNonEmptyString(row.lease_expires_at)
    && isNonEmptyString(row.claim_token);
}

export function parseReminderClaimResponse(data: unknown): ReminderClaim[] {
  if (!Array.isArray(data) || !data.every(isClaimRow)) {
    throw new ReminderWorkerStageError({
      stage: "claim_response",
      code: "INVALID_CLAIM_RESPONSE",
      name: "ReminderClaimResponseError",
      safeMessage: "Reminder claim RPC returned an invalid response contract.",
    });
  }

  return data.map((row) => ({
    deliveryId: row.delivery_id,
    salonId: row.salon_id,
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    channel: row.channel,
    scheduledFor: row.scheduled_for,
    appointmentStart: row.appointment_start,
    recipient: row.recipient,
    salonTimezone: row.salon_timezone,
    attemptCount: row.attempt_count,
    leaseExpiresAt: row.lease_expires_at,
    claimToken: row.claim_token,
  }));
}

export async function claimDueAppointmentRemindersCore(input: {
  client: RpcClient;
  batchSize: number;
  now: Date;
  leaseMinutes: number;
}) {
  let response: { data: unknown; error: unknown };
  try {
    response = await input.client.rpc("claim_due_appointment_reminders", {
      p_batch_size: input.batchSize,
      p_now: input.now.toISOString(),
      p_lease_minutes: input.leaseMinutes,
    });
  } catch (error) {
    throw new ReminderWorkerStageError({
      stage: "claim_rpc",
      code: "REMINDER_CLAIM_RPC_REQUEST_FAILED",
      name: "SupabaseRpcRequestError",
      safeMessage: "Reminder claim RPC request failed before a response was received.",
      cause: error,
    });
  }
  if (response.error) throw classifySupabaseClaimError(response.error);
  return parseReminderClaimResponse(response.data);
}

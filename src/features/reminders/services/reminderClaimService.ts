import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ReminderClaim } from "../types/reminders";

type ClaimRow = { delivery_id: string; salon_id: string; appointment_id: string; client_id: string | null; channel: "sms" | "viber"; scheduled_for: string; appointment_start: string; recipient: string; salon_timezone: string; attempt_count: number; lease_expires_at: string };

export async function claimDueAppointmentReminders({ batchSize = 50, now = new Date(), leaseMinutes = 10 }: { batchSize?: number; now?: Date; leaseMinutes?: number } = {}): Promise<ReminderClaim[]> {
  const { data, error } = await supabaseServer.rpc("claim_due_appointment_reminders", { p_batch_size: batchSize, p_now: now.toISOString(), p_lease_minutes: leaseMinutes });
  if (error) throw new Error("REMINDER_CLAIM_FAILED");
  return ((data ?? []) as ClaimRow[]).map((row) => ({ deliveryId: row.delivery_id, salonId: row.salon_id, appointmentId: row.appointment_id, clientId: row.client_id, channel: row.channel, scheduledFor: row.scheduled_for, appointmentStart: row.appointment_start, recipient: row.recipient, salonTimezone: row.salon_timezone, attemptCount: row.attempt_count, leaseExpiresAt: row.lease_expires_at }));
}


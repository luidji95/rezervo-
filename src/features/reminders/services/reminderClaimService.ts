import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ReminderClaim } from "../types/reminders";
import { claimDueAppointmentRemindersCore } from "./reminderClaimCore";

export async function claimDueAppointmentReminders({ batchSize = 50, now = new Date(), leaseMinutes = 10 }: { batchSize?: number; now?: Date; leaseMinutes?: number } = {}): Promise<ReminderClaim[]> {
  return claimDueAppointmentRemindersCore({ client: supabaseServer, batchSize, now, leaseMinutes });
}

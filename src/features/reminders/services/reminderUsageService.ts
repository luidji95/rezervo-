import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ReminderUsage } from "../types/reminders";

type UsageRow = { salon_id: string; period_start: string; period_end: string; accepted_count: number; max_monthly_reminders: number | null; remaining: number | null };
export async function getSalonReminderUsage(salonId: string, at = new Date()): Promise<ReminderUsage> {
  const { data, error } = await supabaseServer.rpc("get_salon_reminder_usage", { p_salon_id: salonId, p_at: at.toISOString() });
  const row = ((data ?? []) as UsageRow[])[0];
  if (error || !row) throw new Error("REMINDER_USAGE_FAILED");
  return { salonId: row.salon_id, periodStart: row.period_start, periodEnd: row.period_end, acceptedCount: Number(row.accepted_count), maxMonthlyReminders: row.max_monthly_reminders, remaining: row.remaining };
}


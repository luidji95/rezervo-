import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type { SalonSmsSettings } from "../types/reminders";

// A salon without a row has everything off: no confirmations and no reminders.
export async function getSalonSmsSettings(salonId: string): Promise<SalonSmsSettings> {
  const { data, error } = await supabaseServer.from("salon_reminder_settings")
    .select("salon_id,sms_notifications_enabled,enabled,channel,hours_before").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("REMINDER_SETTINGS_LOAD_FAILED");
  return data
    ? { salonId: data.salon_id, smsEnabled: data.sms_notifications_enabled, reminderEnabled: data.enabled, channel: data.channel, hoursBefore: data.hours_before }
    : { salonId, smsEnabled: false, reminderEnabled: false, channel: "sms", hoursBefore: 24 };
}

export async function saveSalonSmsSettings(input: SalonSmsSettings) {
  const { error } = await supabaseServer.from("salon_reminder_settings").upsert({
    salon_id: input.salonId,
    sms_notifications_enabled: input.smsEnabled,
    enabled: input.reminderEnabled,
    channel: input.channel,
    hours_before: input.hoursBefore,
  }, { onConflict: "salon_id" });
  if (error) throw new Error("REMINDER_SETTINGS_SAVE_FAILED");
  return getSalonSmsSettings(input.salonId);
}

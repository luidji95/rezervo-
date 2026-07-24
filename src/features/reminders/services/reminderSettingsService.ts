import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ReminderSettings } from "../types/reminders";

export async function getReminderSettings(salonId: string): Promise<ReminderSettings> {
  const { data, error } = await supabaseServer.from("salon_reminder_settings").select("salon_id,enabled,channel,hours_before").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("REMINDER_SETTINGS_LOAD_FAILED");
  return data ? { salonId: data.salon_id, enabled: data.enabled, channel: data.channel, hoursBefore: data.hours_before } : { salonId, enabled: false, channel: "sms", hoursBefore: 24 };
}

export async function saveReminderSettings(input: ReminderSettings) {
  const { error } = await supabaseServer.from("salon_reminder_settings").upsert({ salon_id: input.salonId, enabled: input.enabled, channel: input.channel, hours_before: input.hoursBefore }, { onConflict: "salon_id" });
  if (error) throw new Error("REMINDER_SETTINGS_SAVE_FAILED");
  return getReminderSettings(input.salonId);
}

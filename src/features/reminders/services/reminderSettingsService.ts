import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type { SalonSmsSettings } from "../types/reminders";
import { isSmsConfirmationStyle } from "@/features/public-booking/sms/bookingConfirmationSmsStyles";

// A salon without a row has everything off: no confirmations and no reminders.
export async function getSalonSmsSettings(salonId: string): Promise<SalonSmsSettings> {
  const { data, error } = await supabaseServer.from("salon_reminder_settings")
    .select("salon_id,sms_notifications_enabled,enabled,channel,hours_before,sms_confirmation_style").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("REMINDER_SETTINGS_LOAD_FAILED");
  return data
    ? {
        salonId: data.salon_id, smsEnabled: data.sms_notifications_enabled, reminderEnabled: data.enabled, channel: data.channel, hoursBefore: data.hours_before,
        confirmationStyle: isSmsConfirmationStyle(data.sms_confirmation_style) ? data.sms_confirmation_style : null,
      }
    : { salonId, smsEnabled: false, reminderEnabled: false, channel: "sms", hoursBefore: 24, confirmationStyle: null };
}

// confirmationStyle undefined keeps the stored style (a client that does not send it changes nothing).
export async function saveSalonSmsSettings(input: Omit<SalonSmsSettings, "confirmationStyle"> & { confirmationStyle?: SalonSmsSettings["confirmationStyle"] }) {
  const { error } = await supabaseServer.from("salon_reminder_settings").upsert({
    salon_id: input.salonId,
    sms_notifications_enabled: input.smsEnabled,
    enabled: input.reminderEnabled,
    channel: input.channel,
    hours_before: input.hoursBefore,
    ...(input.confirmationStyle !== undefined ? { sms_confirmation_style: input.confirmationStyle } : {}),
  }, { onConflict: "salon_id" });
  if (error) throw new Error("REMINDER_SETTINGS_SAVE_FAILED");
  return getSalonSmsSettings(input.salonId);
}

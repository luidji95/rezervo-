import "server-only";
import { createHmac } from "node:crypto";
import { getAppUrl } from "@/lib/appUrl";
import { normalizePhoneToE164 } from "@/lib/phone/phoneNumber";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSmsProvider } from "@/features/reminders/providers/smsProviderFactory";
import { isBookingConfirmationSmsLive, parseRecipientMode, sendBookingConfirmationSmsCore, type BookingConfirmationSmsConfig, type BookingConfirmationSmsInput, type ConfirmationMessageOptions } from "./bookingConfirmationSmsCore";
import { isSmsConfirmationStyle, resolveSmsTemplateSet } from "./bookingConfirmationSmsStyles";

// Global switch (administrator emergency stop): off unless BOOKING_CONFIRMATION_SMS_ENABLED=true. Independent of
// SMS_REMINDERS_RUNTIME_ENABLED. Per salon, the owner's main SMS switch decides (salon_reminder_settings).
export function getBookingConfirmationSmsConfig(): BookingConfirmationSmsConfig {
  const allowed = (process.env.BOOKING_CONFIRMATION_SMS_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((value) => normalizePhoneToE164(value))
    .flatMap((result) => (result.ok ? [result.e164] : []));
  return {
    enabled: process.env.BOOKING_CONFIRMATION_SMS_ENABLED === "true",
    recipientMode: parseRecipientMode(process.env.BOOKING_CONFIRMATION_SMS_RECIPIENT_MODE),
    allowedRecipients: new Set(allowed),
    hashKey: process.env.BOOKING_CONFIRMATION_SMS_HASH_KEY?.trim() || null,
    appUrl: getAppUrl(),
  };
}

export function isBookingConfirmationSmsRuntimeLive() {
  return isBookingConfirmationSmsLive(getBookingConfirmationSmsConfig());
}

// The salon's style and the category of every booked service, read from the stored booking (not from the request).
// Any failed read throws; the caller then sends the standard message.
async function loadConfirmationMessageOptions(appointmentId: string): Promise<ConfirmationMessageOptions> {
  const { data: appointment, error } = await supabaseServer.from("appointments")
    .select("salon_id, primary_service_id").eq("id", appointmentId).single();
  if (error || !appointment) throw new Error("APPOINTMENT_NOT_FOUND");
  const [settingsRes, servicesRes] = await Promise.all([
    supabaseServer.from("salon_reminder_settings").select("sms_confirmation_style").eq("salon_id", appointment.salon_id).maybeSingle(),
    supabaseServer.from("appointment_services").select("service_id").eq("appointment_id", appointmentId),
  ]);
  if (settingsRes.error || servicesRes.error) throw new Error("MESSAGE_OPTIONS_UNAVAILABLE");
  const style = settingsRes.data?.sms_confirmation_style;
  if (!isSmsConfirmationStyle(style)) return { style: null, templateSet: "universal" };
  if (style !== "playful") return { style, templateSet: "universal" };

  const serviceIds = [...new Set(servicesRes.data.length ? servicesRes.data.map((row) => row.service_id) : [appointment.primary_service_id].filter(Boolean))] as string[];
  if (!serviceIds.length) return { style, templateSet: "universal" };
  const { data: services, error: servicesError } = await supabaseServer.from("services")
    .select("id, sms_humor_category").in("id", serviceIds).eq("salon_id", appointment.salon_id);
  if (servicesError) throw new Error("MESSAGE_OPTIONS_UNAVAILABLE");
  const categories = serviceIds.map((id) => services.find((service) => service.id === id)?.sms_humor_category ?? null);
  return { style, templateSet: resolveSmsTemplateSet(categories) };
}

// Runs after the booking response was sent (next/server `after`). Never throws; logs only the outcome code.
export async function sendPublicBookingConfirmationSms(input: BookingConfirmationSmsInput) {
  try {
    const config = getBookingConfirmationSmsConfig();
    if (!config.enabled) return;
    const result = await sendBookingConfirmationSmsCore(input, {
      config,
      hmac: (key, value) => createHmac("sha256", key).update(value, "utf8").digest("hex"),
      reserve: async (appointmentId, recipientHash) => {
        const { data, error } = await supabaseServer.rpc("reserve_public_booking_confirmation_sms_v2", { p_appointment_id: appointmentId, p_recipient_hash: recipientHash });
        if (error) throw new Error(error.code ?? "RPC_ERROR");
        return String(data);
      },
      finish: async ({ appointmentId, status, provider, providerMessageId, errorCode }) => {
        const { data, error } = await supabaseServer.rpc("finish_public_booking_confirmation_sms_v1", {
          p_appointment_id: appointmentId, p_status: status, p_provider: provider, p_provider_message_id: providerMessageId, p_error_code: errorCode,
        });
        if (error) throw new Error(error.code ?? "RPC_ERROR");
        return data === true;
      },
      loadMessageOptions: loadConfirmationMessageOptions,
      provider: getSmsProvider(),
    });
    console.info("PUBLIC_BOOKING_CONFIRMATION_SMS", { appointmentId: input.appointmentId, outcome: result.outcome, errorCode: result.errorCode ?? null });
  } catch {
    console.error("PUBLIC_BOOKING_CONFIRMATION_SMS", { appointmentId: input.appointmentId, outcome: "error", errorCode: "UNEXPECTED" });
  }
}

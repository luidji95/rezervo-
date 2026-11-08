import "server-only";
import { createHmac } from "node:crypto";
import { getAppUrl } from "@/lib/appUrl";
import { normalizePhoneToE164 } from "@/lib/phone/phoneNumber";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSmsProvider } from "@/features/reminders/providers/smsProviderFactory";
import { isBookingConfirmationSmsLive, parseRecipientMode, sendBookingConfirmationSmsCore, type BookingConfirmationSmsConfig, type BookingConfirmationSmsInput } from "./bookingConfirmationSmsCore";

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
      provider: getSmsProvider(),
    });
    console.info("PUBLIC_BOOKING_CONFIRMATION_SMS", { appointmentId: input.appointmentId, outcome: result.outcome, errorCode: result.errorCode ?? null });
  } catch {
    console.error("PUBLIC_BOOKING_CONFIRMATION_SMS", { appointmentId: input.appointmentId, outcome: "error", errorCode: "UNEXPECTED" });
  }
}

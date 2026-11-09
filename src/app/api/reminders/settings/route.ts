import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveSalonEntitlements, EntitlementError } from "@/features/billing/services/entitlementService";
import { isBookingConfirmationSmsRuntimeLive } from "@/features/public-booking/sms/bookingConfirmationSms.server";
import { getReminderRuntimeConfig } from "@/features/reminders/config/reminderRuntimeConfig";
import { canManageSalonReminders } from "@/features/reminders/services/reminderAuthorizationService";
import { getSalonSmsSettings, saveSalonSmsSettings } from "@/features/reminders/services/reminderSettingsService";
import { getSmsSettingsPolicyError } from "@/features/reminders/services/reminderSettingsPolicy";
import { getSalonReminderUsage } from "@/features/reminders/services/reminderUsageService";
import type { ReminderSettingsOverview } from "@/features/reminders/types/reminderSettingsOverview";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { SMS_CONFIRMATION_STYLES } from "@/features/public-booking/sms/bookingConfirmationSmsStyles";

export const dynamic = "force-dynamic";
// smsEnabled: main "SMS obaveštenja" switch (confirmation right after an online booking). reminderEnabled: reminder
// before the appointment, sent only while smsEnabled is also on.
// confirmationStyle: null is the standard message; omitted keeps the stored style.
const updateSchema = z.object({
  smsEnabled: z.boolean(),
  reminderEnabled: z.boolean(),
  hoursBefore: z.number().int().min(1).max(168),
  confirmationStyle: z.enum(SMS_CONFIRMATION_STYLES).nullable().optional(),
}).strict();
function response(code: string, status: number) { return NextResponse.json({ success: false, code }, { status }); }

async function loadOverview(userId: string, salonId: string): Promise<ReminderSettingsOverview> {
  const [settings, entitlements, usage] = await Promise.all([
    getSalonSmsSettings(salonId),
    resolveSalonEntitlements({ authenticatedUserId: userId, salonId }),
    getSalonReminderUsage(salonId).catch(() => null),
  ]);
  return {
    settings: {
      smsEnabled: settings.smsEnabled, reminderEnabled: settings.reminderEnabled, channel: "sms", hoursBefore: settings.hoursBefore,
      confirmationStyle: settings.confirmationStyle,
    },
    entitlement: {
      canUseSmsReminders: entitlements.effectiveCapabilities.canUseSmsReminders,
      maxMonthlyReminders: entitlements.planCapabilities.maxMonthlyReminders,
    },
    runtime: {
      confirmationsReady: isBookingConfirmationSmsRuntimeLive(),
      remindersReady: getReminderRuntimeConfig().smsRuntimeEnabled,
    },
    usage: usage ? {
      used: usage.acceptedCount,
      limit: usage.maxMonthlyReminders,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
    } : null,
  };
}

export async function GET(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return response("UNAUTHORIZED", 401);
  const salonId = new URL(request.url).searchParams.get("salonId");
  if (!salonId) return response("INVALID_INPUT", 400);
  try {
    if (!await canManageSalonReminders(auth.user.id, salonId)) return response("FORBIDDEN", 403);
    return NextResponse.json({ success: true, overview: await loadOverview(auth.user.id, salonId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EntitlementError && error.code === "FORBIDDEN") return response("FORBIDDEN", 403);
    return response("REMINDER_SETTINGS_LOAD_FAILED", 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return response("UNAUTHORIZED", 401);
  const salonId = new URL(request.url).searchParams.get("salonId");
  if (!salonId) return response("INVALID_INPUT", 400);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response("INVALID_INPUT", 400);
  try {
    if (!await canManageSalonReminders(auth.user.id, salonId)) return response("FORBIDDEN", 403);
    const entitlements = await resolveSalonEntitlements({ authenticatedUserId: auth.user.id, salonId });
    if (!entitlements.effectiveCapabilities.canManageBusinessData) {
      return response("SALON_WRITE_ACCESS_REQUIRED", 403);
    }
    const policyError = getSmsSettingsPolicyError({
      smsEnabled: parsed.data.smsEnabled,
      reminderEnabled: parsed.data.reminderEnabled,
      canUseSms: entitlements.effectiveCapabilities.canUseSmsReminders,
    });
    if (policyError) return response(policyError, 403);
    await saveSalonSmsSettings({ salonId, channel: "sms", ...parsed.data });
    return NextResponse.json({ success: true, overview: await loadOverview(auth.user.id, salonId) });
  } catch (error) {
    if (error instanceof EntitlementError && error.code === "FORBIDDEN") return response("FORBIDDEN", 403);
    return response("REMINDER_SETTINGS_SAVE_FAILED", 500);
  }
}

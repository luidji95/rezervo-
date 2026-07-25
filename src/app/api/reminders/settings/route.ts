import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveSalonEntitlements, EntitlementError } from "@/features/billing/services/entitlementService";
import { getReminderRuntimeConfig } from "@/features/reminders/config/reminderRuntimeConfig";
import { canManageSalonReminders } from "@/features/reminders/services/reminderAuthorizationService";
import { getReminderSettings, saveReminderSettings } from "@/features/reminders/services/reminderSettingsService";
import { getReminderSettingsPolicyError } from "@/features/reminders/services/reminderSettingsPolicy";
import { getSalonReminderUsage } from "@/features/reminders/services/reminderUsageService";
import type { ReminderSettingsOverview } from "@/features/reminders/types/reminderSettingsOverview";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";

export const dynamic = "force-dynamic";
const updateSchema = z.object({ enabled: z.boolean(), hoursBefore: z.number().int().min(1).max(168) }).strict();
function response(code: string, status: number) { return NextResponse.json({ success: false, code }, { status }); }

async function loadOverview(userId: string, salonId: string): Promise<ReminderSettingsOverview> {
  const [settings, entitlements, usage] = await Promise.all([
    getReminderSettings(salonId),
    resolveSalonEntitlements({ authenticatedUserId: userId, salonId }),
    getSalonReminderUsage(salonId).catch(() => null),
  ]);
  return {
    settings: { enabled: settings.enabled, channel: "sms", hoursBefore: settings.hoursBefore },
    entitlement: {
      canUseSmsReminders: entitlements.canUseSmsReminders,
      maxMonthlyReminders: entitlements.maxMonthlyReminders,
    },
    runtime: { ready: getReminderRuntimeConfig().smsRuntimeEnabled },
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
    const policyError = getReminderSettingsPolicyError({
      enabled: parsed.data.enabled,
      canUseSmsReminders: entitlements.canUseSmsReminders,
      runtimeReady: getReminderRuntimeConfig().smsRuntimeEnabled,
    });
    if (policyError) return response(policyError, 403);
    await saveReminderSettings({ salonId, channel: "sms", ...parsed.data });
    return NextResponse.json({ success: true, overview: await loadOverview(auth.user.id, salonId) });
  } catch (error) {
    if (error instanceof EntitlementError && error.code === "FORBIDDEN") return response("FORBIDDEN", 403);
    return response("REMINDER_SETTINGS_SAVE_FAILED", 500);
  }
}

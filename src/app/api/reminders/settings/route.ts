import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSalonEntitlement, EntitlementError } from "@/features/billing/services/entitlementService";
import { canManageSalonReminders } from "@/features/reminders/services/reminderAuthorizationService";
import { getReminderSettings, saveReminderSettings } from "@/features/reminders/services/reminderSettingsService";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";

export const dynamic = "force-dynamic";
const updateSchema = z.object({ salonId: z.uuid(), enabled: z.boolean(), channel: z.literal("sms"), hoursBefore: z.number().int().min(1).max(168) }).strict();
function response(code: string, status: number) { return NextResponse.json({ success: false, code }, { status }); }

export async function GET(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return response("UNAUTHORIZED", 401);
  const salonId = new URL(request.url).searchParams.get("salonId");
  if (!salonId) return response("INVALID_INPUT", 400);
  try {
    if (!await canManageSalonReminders(auth.user.id, salonId)) return response("FORBIDDEN", 403);
    return NextResponse.json({ success: true, settings: await getReminderSettings(salonId) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return response("REMINDER_SETTINGS_LOAD_FAILED", 500); }
}

export async function PUT(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return response("UNAUTHORIZED", 401);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response("INVALID_INPUT", 400);
  try {
    if (!await canManageSalonReminders(auth.user.id, parsed.data.salonId)) return response("FORBIDDEN", 403);
    if (parsed.data.enabled) await requireSalonEntitlement({ authenticatedUserId: auth.user.id, salonId: parsed.data.salonId }, "canUseSmsReminders");
    const settings = await saveReminderSettings(parsed.data);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    if (error instanceof EntitlementError && error.code === "ENTITLEMENT_REQUIRED") return response("ENTITLEMENT_REQUIRED", 403);
    return response("REMINDER_SETTINGS_SAVE_FAILED", 500);
  }
}


import { NextResponse } from "next/server";
import { z } from "zod";
import { claimDueAppointmentReminders } from "@/features/reminders/services/reminderClaimService";
import { maskReminderPhone } from "@/features/reminders/services/reminderEligibilityService";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), salonId: z.uuid().optional(), batchSize: z.number().int().min(1).max(500).default(50) }),
  z.object({ action: z.literal("claim"), batchSize: z.number().int().min(1).max(100).default(10), leaseMinutes: z.number().int().min(1).max(60).default(10) }),
  z.object({ action: z.literal("cleanup"), deliveryIds: z.array(z.uuid()).min(1).max(100) }),
]);

export async function POST(request: Request) {
  const configuredSecret = process.env.REMINDER_ADMIN_SECRET;
  if (process.env.NODE_ENV !== "development" || !configuredSecret) return new NextResponse(null, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${configuredSecret}`) return NextResponse.json({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_INPUT" }, { status: 400 });

  if (parsed.data.action === "preview") {
    const { data, error } = await supabaseServer.rpc("preview_due_appointment_reminders", { p_salon_id: parsed.data.salonId ?? null, p_batch_size: parsed.data.batchSize, p_now: new Date().toISOString() });
    if (error) return NextResponse.json({ success: false, code: "REMINDER_PREVIEW_FAILED" }, { status: 500 });
    const rows = data ?? [];
    return NextResponse.json({ success: true, eligibleCount: rows.filter((row: { eligible: boolean }) => row.eligible).length, rows });
  }
  if (parsed.data.action === "claim") {
    const claims = await claimDueAppointmentReminders({ batchSize: parsed.data.batchSize, leaseMinutes: parsed.data.leaseMinutes });
    return NextResponse.json({ success: true, claims: claims.map(({ recipient, ...claim }) => ({ ...claim, recipientMasked: maskReminderPhone(recipient) })) });
  }
  const { data, error } = await supabaseServer.from("appointment_reminder_deliveries").delete().in("id", parsed.data.deliveryIds).is("provider", null).is("sent_at", null).in("status", ["pending", "processing", "failed", "skipped", "cancelled"]).select("id");
  if (error) return NextResponse.json({ success: false, code: "REMINDER_CLEANUP_FAILED" }, { status: 500 });
  return NextResponse.json({ success: true, deletedIds: (data ?? []).map((row) => row.id) });
}

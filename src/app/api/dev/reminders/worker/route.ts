import { NextResponse } from "next/server";
import { z } from "zod";
import { validateDevelopmentSendGuard, validateDevelopmentWorkerAccess } from "@/features/reminders/services/developmentReminderWorkerGuard";
import { runReminderWorker } from "@/features/reminders/services/reminderWorkerService";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("dry_run"), batchSize: z.number().int().min(1).max(100).default(5) }),
  z.object({ mode: z.literal("send"), batchSize: z.literal(1).default(1) }),
]);

export async function POST(request: Request) {
  const access = validateDevelopmentWorkerAccess({
    nodeEnv: process.env.NODE_ENV,
    configuredSecret: process.env.REMINDER_ADMIN_SECRET,
    authorization: request.headers.get("authorization"),
  });
  if (!access.allowed) {
    return access.status === 404
      ? new NextResponse(null, { status: 404 })
      : NextResponse.json({ success: false, code: access.code }, { status: access.status });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_INPUT" }, { status: 400 });

  const guard = validateDevelopmentSendGuard({
    mode: parsed.data.mode,
    batchSize: parsed.data.batchSize,
    allowSend: process.env.REMINDER_WORKER_ALLOW_SEND,
    testRecipient: process.env.INFOBIP_TEST_RECIPIENT,
  });
  if (!guard.allowed) return NextResponse.json({ success: false, code: guard.code }, { status: 403 });

  if (parsed.data.mode === "dry_run") {
    const { data, error } = await supabaseServer.rpc("preview_due_appointment_reminders", {
      p_salon_id: null,
      p_batch_size: parsed.data.batchSize,
      p_now: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ success: false, code: "REMINDER_PREVIEW_FAILED" }, { status: 500 });
    const rows = (data ?? []).map((row: {
      appointment_id: string; scheduled_for: string; eligible: boolean;
      reason: string; recipient_masked: string | null; salon_timezone: string;
    }) => ({
      appointmentId: row.appointment_id,
      scheduledFor: row.scheduled_for,
      eligible: row.eligible,
      reason: row.reason,
      recipientMasked: row.recipient_masked,
      salonTimezone: row.salon_timezone,
    }));
    return NextResponse.json({
      success: true,
      mode: "dry_run",
      eligibleCount: rows.filter((row: { eligible: boolean }) => row.eligible).length,
      rows,
    });
  }

  const testRecipient = process.env.INFOBIP_TEST_RECIPIENT?.trim();
  if (!testRecipient) return NextResponse.json({ success: false, code: "TEST_RECIPIENT_NOT_CONFIGURED" }, { status: 403 });
  const result = await runReminderWorker({ batchSize: 1, allowedRecipient: testRecipient });
  return NextResponse.json({ success: true, mode: "send", result });
}

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getReminderRuntimeConfig } from "@/features/reminders/config/reminderRuntimeConfig";
import { handleReminderCronRequest } from "@/features/reminders/services/reminderCronEndpointCore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function providerAndDatabaseAreConfigured() {
  return Boolean(
    process.env.INFOBIP_BASE_URL?.trim()
      && process.env.INFOBIP_API_KEY?.trim()
      && process.env.INFOBIP_SMS_SENDER?.trim()
      && process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
      && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const runId = randomUUID();
  const result = await handleReminderCronRequest({
    authorization: request.headers.get("authorization"),
    configuredSecret: process.env.REMINDER_CRON_SECRET,
    runtimeEnabled: getReminderRuntimeConfig().smsRuntimeEnabled,
    batchSizeValue: process.env.REMINDER_CRON_BATCH_SIZE,
    providerAndDatabaseConfigured: providerAndDatabaseAreConfigured(),
    runWorker: async (batchSize) => {
      // Keep service-role and provider modules unloaded until auth, runtime and
      // configuration gates have all passed.
      const { runReminderWorker } = await import("@/features/reminders/services/reminderWorkerService");
      return runReminderWorker({ batchSize });
    },
  });

  if (result.statusCode === 200) {
    console.info("Reminder cron completed", {
      runId,
      runtimeEnabled: getReminderRuntimeConfig().smsRuntimeEnabled,
      claimed: "claimed" in result.body ? result.body.claimed : 0,
      processed: "processed" in result.body ? result.body.processed : 0,
      accepted: "accepted" in result.body ? result.body.accepted : 0,
      failed: "failed" in result.body ? result.body.failed : 0,
      durationMs: Date.now() - startedAt,
    });
  } else if (result.statusCode !== 401) {
    console.error("Reminder cron failed", {
      runId,
      statusCode: result.statusCode,
      durationMs: Date.now() - startedAt,
    });
  }

  return NextResponse.json(result.body, {
    status: result.statusCode,
    headers: { "Cache-Control": "no-store" },
  });
}

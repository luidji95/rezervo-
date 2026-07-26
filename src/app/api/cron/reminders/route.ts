import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getReminderRuntimeConfig } from "@/features/reminders/config/reminderRuntimeConfig";
import {
  buildReminderCronFailureLog,
  getReminderWorkerReadiness,
  handleReminderCronRequest,
} from "@/features/reminders/services/reminderCronEndpointCore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const runId = randomUUID();
  const readiness = getReminderWorkerReadiness({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    infobipBaseUrl: process.env.INFOBIP_BASE_URL,
    infobipApiKey: process.env.INFOBIP_API_KEY,
    infobipSender: process.env.INFOBIP_SMS_SENDER,
  });
  const result = await handleReminderCronRequest({
    authorization: request.headers.get("authorization"),
    configuredSecret: process.env.REMINDER_CRON_SECRET,
    runtimeEnabled: getReminderRuntimeConfig().smsRuntimeEnabled,
    batchSizeValue: process.env.REMINDER_CRON_BATCH_SIZE,
    providerAndDatabaseConfigured: readiness.ready,
    runId,
    sensitiveValues: [
      process.env.REMINDER_CRON_SECRET,
      process.env.INFOBIP_API_KEY,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ].filter((value): value is string => Boolean(value)),
    runWorker: async (batchSize) => {
      // Keep service-role and provider modules unloaded until auth, runtime and
      // configuration gates have all passed.
      try {
        const { runReminderWorker } = await import("@/features/reminders/services/reminderWorkerService");
        return runReminderWorker({ batchSize });
      } catch (error) {
        const { ReminderWorkerStageError } = await import("@/features/reminders/services/reminderWorkerDiagnostics");
        if (error instanceof ReminderWorkerStageError) throw error;
        throw new ReminderWorkerStageError({
          stage: "supabase_initialization",
          code: "WORKER_DEPENDENCY_INITIALIZATION_FAILED",
          name: "WorkerDependencyInitializationError",
          safeMessage: "Reminder worker dependencies could not be initialized.",
          cause: error,
        });
      }
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
    console.error(buildReminderCronFailureLog({
      runId,
      statusCode: result.statusCode,
      diagnostic: result.diagnostic,
      durationMs: Date.now() - startedAt,
      readiness,
    }));
  }

  return NextResponse.json(result.body, {
    status: result.statusCode,
    headers: { "Cache-Control": "no-store" },
  });
}

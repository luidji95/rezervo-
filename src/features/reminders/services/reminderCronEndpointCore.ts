import { timingSafeEqual } from "node:crypto";

import type { ReminderWorkerRunResult } from "./reminderWorkerCore";
import { normalizeWorkerError, type SafeWorkerError } from "./reminderWorkerDiagnostics.ts";

const DEFAULT_BATCH_SIZE = 5;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 20;

export type ReminderCronResponse = {
  status: "runtime_disabled" | "completed";
  claimed: number;
  processed: number;
  accepted?: number;
  retryScheduled?: number;
  failed?: number;
  cancelled?: number;
  skipped?: number;
};

export type ReminderCronEndpointResult = {
  statusCode: 200 | 401 | 500 | 503;
  body: ReminderCronResponse | { status: "error"; code: string; runId?: string };
  diagnostic?: SafeWorkerError;
};

export type ReminderWorkerReadiness = {
  supabaseConfigured: boolean;
  infobipConfigured: boolean;
  ready: boolean;
};

export function getReminderWorkerReadiness(environment: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  infobipBaseUrl?: string;
  infobipApiKey?: string;
  infobipSender?: string;
}): ReminderWorkerReadiness {
  const supabaseConfigured = Boolean(environment.supabaseUrl?.trim() && environment.serviceRoleKey?.trim());
  const infobipConfigured = Boolean(
    environment.infobipBaseUrl?.trim()
      && environment.infobipApiKey?.trim()
      && environment.infobipSender?.trim(),
  );
  return { supabaseConfigured, infobipConfigured, ready: supabaseConfigured && infobipConfigured };
}

export function buildReminderCronFailureLog(input: {
  runId: string;
  statusCode: number;
  diagnostic?: SafeWorkerError;
  durationMs: number;
  readiness?: ReminderWorkerReadiness;
}) {
  return {
    event: "reminder_cron_failed",
    runId: input.runId,
    statusCode: input.statusCode,
    stage: input.diagnostic?.stage ?? "unknown",
    errorCode: input.diagnostic?.code ?? "REMINDER_WORKER_FAILED",
    errorName: input.diagnostic?.name ?? "UnknownWorkerError",
    safeMessage: input.diagnostic?.safeMessage ?? "Reminder worker failed unexpectedly.",
    durationMs: input.durationMs,
    ...(input.readiness ? { readiness: input.readiness } : {}),
  };
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyReminderCronBearerAuth(input: {
  authorization: string | null;
  configuredSecret?: string;
}) {
  const secret = input.configuredSecret?.trim();
  if (!secret || !input.authorization) return false;
  return timingSafeStringEqual(input.authorization, `Bearer ${secret}`);
}

export function parseReminderCronBatchSize(value?: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, parsed));
}

export async function handleReminderCronRequest(input: {
  authorization: string | null;
  configuredSecret?: string;
  runtimeEnabled: boolean;
  batchSizeValue?: string;
  providerAndDatabaseConfigured: boolean;
  runId?: string;
  sensitiveValues?: string[];
  runWorker: (batchSize: number) => Promise<ReminderWorkerRunResult>;
}): Promise<ReminderCronEndpointResult> {
  if (!verifyReminderCronBearerAuth(input)) {
    return { statusCode: 401, body: { status: "error", code: "UNAUTHORIZED" } };
  }

  if (!input.runtimeEnabled) {
    return {
      statusCode: 200,
      body: { status: "runtime_disabled", claimed: 0, processed: 0 },
    };
  }

  if (!input.providerAndDatabaseConfigured) {
    return {
      statusCode: 503,
      body: { status: "error", code: "REMINDER_WORKER_NOT_CONFIGURED", runId: input.runId },
      diagnostic: {
        stage: "configuration",
        code: "REMINDER_WORKER_NOT_CONFIGURED",
        name: "ReminderWorkerConfigurationError",
        safeMessage: "Required reminder worker server configuration is missing.",
      },
    };
  }

  try {
    const result = await input.runWorker(parseReminderCronBatchSize(input.batchSizeValue));
    return {
      statusCode: 200,
      body: {
        status: "completed",
        claimed: result.claimed,
        processed: result.processed,
        accepted: result.accepted,
        retryScheduled: result.retryScheduled,
        failed: result.failed,
        cancelled: result.cancelled,
        skipped: result.skipped,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: { status: "error", code: "REMINDER_WORKER_FAILED", runId: input.runId },
      diagnostic: normalizeWorkerError(error, "unknown", input.sensitiveValues),
    };
  }
}

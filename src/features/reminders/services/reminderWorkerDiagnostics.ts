export type ReminderWorkerErrorStage =
  | "configuration"
  | "supabase_initialization"
  | "claim_rpc"
  | "claim_response"
  | "final_validation"
  | "provider_initialization"
  | "item_processing"
  | "worker_processing"
  | "unknown";

export type SafeWorkerError = {
  stage: ReminderWorkerErrorStage;
  code: string;
  name: string;
  safeMessage: string;
};

const MAX_CODE_LENGTH = 64;
const MAX_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 240;
const PHONE_PATTERN = /\+[1-9]\d{7,14}/g;
const AUTH_PATTERN = /\b(?:Authorization\s*[:=]\s*)?(?:Bearer|Basic|App)\s+[A-Za-z0-9+/_=.-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function bounded(value: string, maximum: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function sanitizeWorkerErrorText(value: unknown, sensitiveValues: string[] = []) {
  if (typeof value !== "string") return "";
  let sanitized = value;
  for (const secret of sensitiveValues) {
    const trimmed = secret.trim();
    if (trimmed.length >= 4) sanitized = sanitized.split(trimmed).join("[REDACTED]");
  }
  sanitized = sanitized
    .replace(AUTH_PATTERN, "[REDACTED_AUTH]")
    .replace(JWT_PATTERN, "[REDACTED_TOKEN]")
    .replace(PHONE_PATTERN, (phone) => `${phone.slice(0, 4)}*****${phone.slice(-3)}`);
  return bounded(sanitized, MAX_MESSAGE_LENGTH);
}

function safeCode(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, MAX_CODE_LENGTH);
  return /^[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : fallback;
}

function safeName(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = bounded(value, MAX_NAME_LENGTH);
  return /^[A-Za-z0-9_. -]+$/.test(normalized) ? normalized : fallback;
}

export class ReminderWorkerStageError extends Error {
  readonly stage: ReminderWorkerErrorStage;
  readonly code: string;
  readonly safeMessage: string;

  constructor(input: {
    stage: ReminderWorkerErrorStage;
    code: string;
    name?: string;
    safeMessage: string;
    cause?: unknown;
  }) {
    super(input.safeMessage, { cause: input.cause });
    this.name = input.name ?? "ReminderWorkerStageError";
    this.stage = input.stage;
    this.code = input.code;
    this.safeMessage = input.safeMessage;
  }
}

export function normalizeWorkerError(
  error: unknown,
  fallbackStage: ReminderWorkerErrorStage = "unknown",
  sensitiveValues: string[] = [],
): SafeWorkerError {
  if (error instanceof ReminderWorkerStageError) {
    return {
      stage: error.stage,
      code: safeCode(error.code, "REMINDER_WORKER_FAILED"),
      name: safeName(error.name, "ReminderWorkerStageError"),
      safeMessage: sanitizeWorkerErrorText(error.safeMessage, sensitiveValues) || "Reminder worker stage failed.",
    };
  }

  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const message = error instanceof Error ? error.message
    : typeof error === "string" ? error
      : record?.message;
  return {
    stage: fallbackStage,
    code: safeCode(record?.code, "REMINDER_WORKER_FAILED"),
    name: safeName(error instanceof Error ? error.name : record?.name, "UnknownWorkerError"),
    safeMessage: sanitizeWorkerErrorText(message, sensitiveValues) || "Reminder worker failed unexpectedly.",
  };
}

export function classifySupabaseClaimError(error: unknown): ReminderWorkerStageError {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = safeCode(record.code, "REMINDER_CLAIM_RPC_FAILED");
  const message = typeof record.message === "string" ? record.message : "";
  let safeMessage = "Reminder claim RPC could not be executed.";

  if (code === "42501" || /permission denied/i.test(message)) {
    safeMessage = "Reminder claim RPC permission was denied.";
  } else if (code === "PGRST202" || /function|schema cache|signature/i.test(message)) {
    safeMessage = "Reminder claim RPC function is unavailable or its signature is not present in the schema cache.";
  } else if (/^PGRST/.test(code)) {
    safeMessage = "Reminder claim RPC could not be resolved by the Supabase API.";
  } else if (/^[0-9A-Z]{5}$/.test(code)) {
    safeMessage = "Reminder claim RPC returned a controlled SQL error.";
  }

  return new ReminderWorkerStageError({
    stage: "claim_rpc",
    code,
    name: "SupabaseRpcError",
    safeMessage,
    cause: error,
  });
}

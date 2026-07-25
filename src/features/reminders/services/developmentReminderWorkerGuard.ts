export type DevelopmentWorkerMode = "dry_run" | "send";

export function validateDevelopmentWorkerAccess(input: {
  nodeEnv?: string;
  configuredSecret?: string;
  authorization?: string | null;
}) {
  if (input.nodeEnv !== "development" || !input.configuredSecret) return { allowed: false as const, status: 404, code: "NOT_FOUND" };
  if (input.authorization !== `Bearer ${input.configuredSecret}`) return { allowed: false as const, status: 401, code: "UNAUTHORIZED" };
  return { allowed: true as const };
}

export function validateDevelopmentSendGuard(input: {
  mode: DevelopmentWorkerMode;
  batchSize: number;
  allowSend?: string;
  testRecipient?: string;
}) {
  if (input.mode === "dry_run") return { allowed: true as const };
  if (input.batchSize !== 1) return { allowed: false as const, code: "SEND_BATCH_SIZE_MUST_BE_ONE" };
  if (input.allowSend !== "true") return { allowed: false as const, code: "REMINDER_WORKER_SEND_DISABLED" };
  if (!input.testRecipient?.trim()) return { allowed: false as const, code: "TEST_RECIPIENT_NOT_CONFIGURED" };
  return { allowed: true as const };
}

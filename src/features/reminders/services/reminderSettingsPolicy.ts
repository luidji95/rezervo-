export type ReminderSettingsPolicyError = "ENTITLEMENT_REQUIRED" | "REMINDER_RUNTIME_NOT_READY";

export function getReminderSettingsPolicyError(input: {
  enabled: boolean;
  canUseSmsReminders: boolean;
  runtimeReady: boolean;
}): ReminderSettingsPolicyError | null {
  if (!input.canUseSmsReminders) return "ENTITLEMENT_REQUIRED";
  if (input.enabled && !input.runtimeReady) return "REMINDER_RUNTIME_NOT_READY";
  return null;
}

import "server-only";

export type ReminderRuntimeConfig = {
  smsRuntimeEnabled: boolean;
};

export function getReminderRuntimeConfig(): ReminderRuntimeConfig {
  return {
    smsRuntimeEnabled: process.env.SMS_REMINDERS_RUNTIME_ENABLED === "true",
  };
}

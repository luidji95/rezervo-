export type ReminderSettingsOverview = {
  settings: {
    enabled: boolean;
    channel: "sms";
    hoursBefore: number;
  };
  entitlement: {
    canUseSmsReminders: boolean;
    maxMonthlyReminders: number | null;
  };
  runtime: {
    ready: boolean;
  };
  usage: {
    used: number;
    limit: number | null;
    periodStart: string;
    periodEnd: string;
  } | null;
};

export type ReminderSettingsErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "ENTITLEMENT_REQUIRED"
  | "REMINDER_RUNTIME_NOT_READY"
  | "REMINDER_SETTINGS_LOAD_FAILED"
  | "REMINDER_SETTINGS_SAVE_FAILED";

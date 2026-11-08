export type ReminderSettingsOverview = {
  settings: {
    smsEnabled: boolean;
    reminderEnabled: boolean;
    channel: "sms";
    hoursBefore: number;
  };
  entitlement: {
    canUseSmsReminders: boolean;
    maxMonthlyReminders: number | null;
  };
  // Global administrator switches (emergency stop). When one is off, the salon's choice is kept but nothing of
  // that kind is sent.
  runtime: {
    confirmationsReady: boolean;
    remindersReady: boolean;
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
  | "SALON_WRITE_ACCESS_REQUIRED"
  | "REMINDER_SETTINGS_LOAD_FAILED"
  | "REMINDER_SETTINGS_SAVE_FAILED";

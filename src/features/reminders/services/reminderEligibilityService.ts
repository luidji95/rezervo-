export type ReminderEligibilityReason = "ELIGIBLE" | "SUBSCRIPTION_INACTIVE" | "ENTITLEMENT_REQUIRED" | "REMINDERS_DISABLED" | "UNSUPPORTED_CHANNEL" | "APPOINTMENT_NOT_ELIGIBLE" | "APPOINTMENT_IN_PAST" | "NOT_DUE" | "MISSING_RECIPIENT" | "QUOTA_EXHAUSTED";

export type ReminderEligibilityInput = {
  now: Date;
  subscriptionStatus: string;
  canUseSmsReminders: boolean;
  settingsEnabled: boolean;
  channel: string;
  hoursBefore: number;
  appointmentStatus: string;
  appointmentStart: Date;
  phone: string | null;
  acceptedUsage: number;
  maxMonthlyReminders: number | null;
};

export function normalizeReminderPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return phone.trim().startsWith("+") ? `+${digits}` : digits;
}

export function maskReminderPhone(phone: string | null) {
  const normalized = normalizeReminderPhone(phone);
  if (!normalized) return null;
  const prefixLength = normalized.startsWith("+") ? 5 : 4;
  return `${normalized.slice(0, prefixLength)}*****${normalized.slice(-3)}`;
}

export function evaluateReminderEligibility(input: ReminderEligibilityInput) {
  const scheduledFor = new Date(input.appointmentStart.getTime() - input.hoursBefore * 3_600_000);
  let reason: ReminderEligibilityReason = "ELIGIBLE";
  if (!input.settingsEnabled) reason = "REMINDERS_DISABLED";
  else if (!input.canUseSmsReminders) reason = "ENTITLEMENT_REQUIRED";
  else if (!new Set(["active", "trialing"]).has(input.subscriptionStatus)) reason = "SUBSCRIPTION_INACTIVE";
  else if (input.channel !== "sms") reason = "UNSUPPORTED_CHANNEL";
  else if (!new Set(["pending", "confirmed"]).has(input.appointmentStatus)) reason = "APPOINTMENT_NOT_ELIGIBLE";
  else if (input.appointmentStart <= input.now) reason = "APPOINTMENT_IN_PAST";
  else if (scheduledFor > input.now) reason = "NOT_DUE";
  else if (!normalizeReminderPhone(input.phone)) reason = "MISSING_RECIPIENT";
  else if (input.maxMonthlyReminders !== null && input.acceptedUsage >= input.maxMonthlyReminders) reason = "QUOTA_EXHAUSTED";
  return { eligible: reason === "ELIGIBLE", reason, scheduledFor, recipient: normalizeReminderPhone(input.phone) };
}

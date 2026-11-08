export type SmsSettingsPolicyError = "ENTITLEMENT_REQUIRED";

// Switching anything on needs the SMS right of the plan (Pro, including the Pro trial). Switching off is always
// allowed, so a salon that lost the right can still turn its SMS off. The global switches are an administrator
// emergency stop and do not block saving; the overview tells the owner when sending is paused.
export function getSmsSettingsPolicyError(input: {
  smsEnabled: boolean;
  reminderEnabled: boolean;
  canUseSms: boolean;
}): SmsSettingsPolicyError | null {
  if ((input.smsEnabled || input.reminderEnabled) && !input.canUseSms) return "ENTITLEMENT_REQUIRED";
  return null;
}

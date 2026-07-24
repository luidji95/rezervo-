import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReminderEligibility, normalizeReminderPhone } from "./reminderEligibilityService.ts";

const now = new Date("2026-07-25T10:00:00.000Z");
const eligible = {
  now, subscriptionStatus: "active", canUseSmsReminders: true,
  settingsEnabled: true, channel: "sms", hoursBefore: 24,
  appointmentStatus: "pending", appointmentStart: new Date("2026-07-26T09:00:00.000Z"),
  phone: "+381 64 123 4567", acceptedUsage: 0, maxMonthlyReminders: null,
};

test("active and trialing Pro-like entitlement inputs are eligible", () => {
  assert.equal(evaluateReminderEligibility(eligible).reason, "ELIGIBLE");
  assert.equal(evaluateReminderEligibility({ ...eligible, subscriptionStatus: "trialing" }).eligible, true);
});
test("entitlement, settings, status, time and recipient failures are controlled", () => {
  assert.equal(evaluateReminderEligibility({ ...eligible, canUseSmsReminders: false }).reason, "ENTITLEMENT_REQUIRED");
  assert.equal(evaluateReminderEligibility({ ...eligible, settingsEnabled: false }).reason, "REMINDERS_DISABLED");
  for (const appointmentStatus of ["cancelled", "completed", "no_show"]) assert.equal(evaluateReminderEligibility({ ...eligible, appointmentStatus }).reason, "APPOINTMENT_NOT_ELIGIBLE");
  assert.equal(evaluateReminderEligibility({ ...eligible, appointmentStart: new Date("2026-07-25T09:00:00Z") }).reason, "APPOINTMENT_IN_PAST");
  assert.equal(evaluateReminderEligibility({ ...eligible, phone: null }).reason, "MISSING_RECIPIENT");
});
test("quota counts accepted usage and null means unlimited", () => {
  assert.equal(evaluateReminderEligibility({ ...eligible, maxMonthlyReminders: 1, acceptedUsage: 1 }).reason, "QUOTA_EXHAUSTED");
  assert.equal(evaluateReminderEligibility({ ...eligible, maxMonthlyReminders: null, acceptedUsage: 999 }).eligible, true);
});
test("scheduled instant is stable across equivalent timezone inputs", () => {
  const belgrade = evaluateReminderEligibility({ ...eligible, appointmentStart: new Date("2026-10-25T10:00:00+01:00") });
  const utc = evaluateReminderEligibility({ ...eligible, appointmentStart: new Date("2026-10-25T09:00:00Z") });
  assert.equal(belgrade.scheduledFor.toISOString(), utc.scheduledFor.toISOString());
  assert.equal(normalizeReminderPhone("+381 (64) 123-4567"), "+381641234567");
});

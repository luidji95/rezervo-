import assert from "node:assert/strict";
import test from "node:test";
import { getReminderSettingsPolicyError } from "./reminderSettingsPolicy.ts";

test("Starter-like entitlement cannot update reminder settings", () => {
  assert.equal(getReminderSettingsPolicyError({ enabled: true, canUseSmsReminders: false, runtimeReady: true }), "ENTITLEMENT_REQUIRED");
  assert.equal(getReminderSettingsPolicyError({ enabled: false, canUseSmsReminders: false, runtimeReady: false }), "ENTITLEMENT_REQUIRED");
});

test("runtime blocks enabling but permits disabling for entitled salons", () => {
  assert.equal(getReminderSettingsPolicyError({ enabled: true, canUseSmsReminders: true, runtimeReady: false }), "REMINDER_RUNTIME_NOT_READY");
  assert.equal(getReminderSettingsPolicyError({ enabled: false, canUseSmsReminders: true, runtimeReady: false }), null);
});

test("entitled salon can enable or disable when runtime is ready", () => {
  assert.equal(getReminderSettingsPolicyError({ enabled: true, canUseSmsReminders: true, runtimeReady: true }), null);
  assert.equal(getReminderSettingsPolicyError({ enabled: false, canUseSmsReminders: true, runtimeReady: true }), null);
});

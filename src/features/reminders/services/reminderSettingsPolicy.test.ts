import assert from "node:assert/strict";
import test from "node:test";
import { getSmsSettingsPolicyError } from "./reminderSettingsPolicy.ts";

test("switching SMS on needs the plan's SMS right", () => {
  assert.equal(getSmsSettingsPolicyError({ smsEnabled: true, reminderEnabled: false, canUseSms: false }), "ENTITLEMENT_REQUIRED");
  assert.equal(getSmsSettingsPolicyError({ smsEnabled: true, reminderEnabled: true, canUseSms: false }), "ENTITLEMENT_REQUIRED");
  assert.equal(getSmsSettingsPolicyError({ smsEnabled: false, reminderEnabled: true, canUseSms: false }), "ENTITLEMENT_REQUIRED");
});

test("switching everything off is allowed with or without the right", () => {
  assert.equal(getSmsSettingsPolicyError({ smsEnabled: false, reminderEnabled: false, canUseSms: false }), null);
  assert.equal(getSmsSettingsPolicyError({ smsEnabled: false, reminderEnabled: false, canUseSms: true }), null);
});

test("an entitled salon can use any combination", () => {
  for (const smsEnabled of [true, false]) {
    for (const reminderEnabled of [true, false]) {
      assert.equal(getSmsSettingsPolicyError({ smsEnabled, reminderEnabled, canUseSms: true }), null);
    }
  }
});

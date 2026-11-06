import test from "node:test";
import assert from "node:assert/strict";
import { getAppointmentNotEndedHint, hasAppointmentEnded, isOutcomeStatus } from "./appointmentOutcomeTiming.ts";

const end = "2026-11-06T10:30:00.000Z";
test("ended exactly at end_time, not a millisecond before", () => {
  assert.equal(hasAppointmentEnded(end, Date.parse(end) - 1), false);
  assert.equal(hasAppointmentEnded(end, Date.parse(end)), true);
  assert.equal(hasAppointmentEnded(end, Date.parse(end) + 60_000), true);
});
test("invalid end_time never unlocks the action", () => assert.equal(hasAppointmentEnded("not-a-date", Date.now()), false));
test("only completed and no_show are time-gated", () => {
  assert.deepEqual(["confirmed", "completed", "cancelled", "no_show"].map(isOutcomeStatus), [false, true, false, true]);
});
test("hint names the end time in the salon time zone", () => assert.match(getAppointmentNotEndedHint(end, "Europe/Belgrade"), /11:30/));

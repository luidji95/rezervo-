import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCalendarItemTop,
  deriveCalendarVisibleRange,
  getCalendarLocalMinutes,
} from "./calendarTimeRange.ts";

const sunday = "2026-07-26";
const timeZone = "Europe/Belgrade";

function hours(opens_at = "09:00:00", closes_at = "17:00:00") {
  return [{ day_of_week: 0, opens_at, closes_at, is_working_day: true }];
}

function appointment(start_time: string, end_time: string, status = "pending") {
  return { start_time, end_time, status };
}

test("uses configured working hours and a safe default when unavailable", () => {
  assert.deepEqual(deriveCalendarVisibleRange({
    selectedDate: sunday,
    timeZone,
    workingHours: hours(),
    appointments: [],
  }), {
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    hourLabels: ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"],
  });
  const fallback = deriveCalendarVisibleRange({ selectedDate: sunday, timeZone, workingHours: [], appointments: [] });
  assert.equal(fallback.startMinute, 8 * 60);
  assert.equal(fallback.endMinute, 21 * 60);
});

test("23:55 closing time extends the grid to midnight and shows a 23:00 appointment", () => {
  const range = deriveCalendarVisibleRange({
    selectedDate: sunday,
    timeZone,
    workingHours: hours("09:00:00", "23:55:00"),
    appointments: [appointment("2026-07-26T21:00:00.000Z", "2026-07-26T21:30:00.000Z")],
  });
  assert.equal(range.endMinute, 24 * 60);
  assert.equal(range.hourLabels.at(-1), "23:00");
  assert.ok(calculateCalendarItemTop("2026-07-26T21:00:00.000Z", sunday, timeZone, range.startMinute) >= 0);
});

test("shows 21:30 pending appointments and never filters them by status", () => {
  const pending = appointment("2026-07-26T19:30:00.000Z", "2026-07-26T20:00:00.000Z", "pending");
  const range = deriveCalendarVisibleRange({ selectedDate: sunday, timeZone, workingHours: hours(), appointments: [pending] });
  assert.equal(range.endMinute, 22 * 60);
  assert.equal(getCalendarLocalMinutes(pending.start_time, sunday, timeZone), 21 * 60 + 30);
  assert.ok(calculateCalendarItemTop(pending.start_time, sunday, timeZone, range.startMinute) >= 0);
});

test("an appointment remains visible after working hours are shortened", () => {
  const late = appointment("2026-07-26T19:30:00.000Z", "2026-07-26T20:00:00.000Z");
  const before = deriveCalendarVisibleRange({ selectedDate: sunday, timeZone, workingHours: hours("09:00:00", "23:55:00"), appointments: [late] });
  const after = deriveCalendarVisibleRange({ selectedDate: sunday, timeZone, workingHours: hours("09:00:00", "17:00:00"), appointments: [late] });
  assert.equal(before.endMinute, 24 * 60);
  assert.equal(after.endMinute, 22 * 60);
  assert.ok(calculateCalendarItemTop(late.start_time, sunday, timeZone, after.startMinute) >= 0);
});

test("updated working hours produce a new range without stale values", () => {
  const initial = deriveCalendarVisibleRange({ selectedDate: sunday, timeZone, workingHours: hours("09:00:00", "17:00:00"), appointments: [] });
  const updated = deriveCalendarVisibleRange({ selectedDate: sunday, timeZone, workingHours: hours("09:00:00", "23:55:00"), appointments: [] });
  assert.equal(initial.endMinute, 17 * 60);
  assert.equal(updated.endMinute, 24 * 60);
});

test("converts UTC instants to Belgrade local time without a hardcoded offset", () => {
  assert.equal(getCalendarLocalMinutes("2026-07-26T19:30:00.000Z", sunday, timeZone), 21 * 60 + 30);
});

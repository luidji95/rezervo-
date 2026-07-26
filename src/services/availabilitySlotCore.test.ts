import assert from "node:assert/strict";
import test from "node:test";

import { zonedDateTimeToUtc } from "../lib/salonDateTime.ts";
import {
  PUBLIC_BOOKING_MIN_NOTICE_MINUTES,
  generateScheduleSlots,
} from "./availabilitySlotCore.ts";

const date = "2026-07-26";
const timeZone = "Europe/Belgrade";

function at(time: string) {
  return zonedDateTimeToUtc(date, time, timeZone);
}

function startsAt(slots: ReturnType<typeof generateScheduleSlots>, time: string) {
  return slots.some((slot) => slot.start.getTime() === at(time).getTime());
}

test("offers 23:00 at 22:40 when a 30-minute service ends before 23:59", () => {
  const slots = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("09:00"), workEnd: at("23:59"),
    durationMinutes: 30, now: at("22:40"),
  });
  assert.equal(startsAt(slots, "23:00"), true);
});

test("allows equality at closing and rejects a service ending after closing", () => {
  const exact = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("23:00"), workEnd: at("23:30"),
    durationMinutes: 30, now: at("22:40"),
  });
  const late = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("23:00"), workEnd: at("23:29"),
    durationMinutes: 30, now: at("22:40"),
  });
  assert.equal(exact.length, 1);
  assert.equal(late.length, 0);
});

test("removes overlaps and respects an earlier employee closing time", () => {
  const withConflict = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("22:30"), workEnd: at("23:59"),
    durationMinutes: 30, now: at("22:00"),
    unavailableRanges: [{ start: at("23:00"), end: at("23:30") }],
  });
  const employeeEndsEarly = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("22:30"), workEnd: at("23:15"),
    durationMinutes: 30, now: at("22:00"),
  });
  assert.equal(startsAt(withConflict, "23:00"), false);
  assert.equal(startsAt(employeeEndsEarly, "23:00"), false);
});

test("uses Belgrade local time and freshly supplied working hours", () => {
  assert.equal(at("23:00").toISOString(), "2026-07-26T21:00:00.000Z");
  const oldHours = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("09:00"), workEnd: at("20:00"),
    durationMinutes: 30, now: at("19:00"),
  });
  const updatedHours = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("09:00"), workEnd: at("23:59"),
    durationMinutes: 30, now: at("19:00"),
  });
  assert.equal(startsAt(oldHours, "23:00"), false);
  assert.equal(startsAt(updatedHours, "23:00"), true);
});

test("uses intentional future-only same-day filtering without a hidden notice", () => {
  assert.equal(PUBLIC_BOOKING_MIN_NOTICE_MINUTES, 0);
  const slots = generateScheduleSlots({
    selectedDate: date, timeZone, workStart: at("22:30"), workEnd: at("23:30"),
    durationMinutes: 30, now: at("22:40"),
  });
  assert.equal(startsAt(slots, "22:30"), false);
  assert.equal(startsAt(slots, "23:00"), true);
});

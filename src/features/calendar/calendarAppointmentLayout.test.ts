import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCalendarColumn } from "./calendarAppointmentLayout.ts";

const at = (hhmm: string) => `2026-11-09T${hhmm}:00.000Z`;
const item = (id: string, start: string, end: string, status: string) => ({ id, start_time: at(start), end_time: at(end), status });

test("rebooked slot: the confirmed appointment comes first and both cards get their own lane", () => {
  // Database order: the cancelled one first (as returned for equal start times).
  const { sorted, layout } = layoutCalendarColumn([item("old", "08:00", "08:30", "cancelled"), item("new", "08:00", "08:30", "confirmed")]);
  assert.deepEqual(sorted.map((a) => a.id), ["new", "old"]);
  assert.deepEqual(layout.get("new"), { lane: 0, lanes: 2 });
  assert.deepEqual(layout.get("old"), { lane: 1, lanes: 2 });
});

test("order does not depend on the input order", () => {
  const a = layoutCalendarColumn([item("new", "08:00", "08:30", "confirmed"), item("old", "08:00", "08:30", "cancelled")]);
  const b = layoutCalendarColumn([item("old", "08:00", "08:30", "cancelled"), item("new", "08:00", "08:30", "confirmed")]);
  assert.deepEqual([...a.layout], [...b.layout]);
});

test("non-overlapping appointments keep the full width", () => {
  const { layout } = layoutCalendarColumn([item("a", "08:00", "08:30", "confirmed"), item("b", "08:30", "09:00", "cancelled"), item("c", "10:00", "10:45", "pending")]);
  for (const id of ["a", "b", "c"]) assert.deepEqual(layout.get(id), { lane: 0, lanes: 1 }, id);
});

test("partial overlaps share one cluster and reuse free lanes", () => {
  const { layout } = layoutCalendarColumn([
    item("x", "08:00", "09:00", "cancelled"),
    item("y", "08:30", "09:30", "confirmed"),
    item("z", "09:00", "09:30", "no_show"),
  ]);
  assert.deepEqual(layout.get("x"), { lane: 0, lanes: 2 });
  assert.deepEqual(layout.get("y"), { lane: 1, lanes: 2 });
  assert.deepEqual(layout.get("z"), { lane: 0, lanes: 2 });
});

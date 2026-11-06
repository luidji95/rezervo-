import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToDateKey, formatDateLong, formatMonthYear, formatTimeRange, getDayParts, getDayWindow, getServiceCategoryFilters, groupSlotsByDayPart,
} from "./publicBookingFormat.ts";
import type { PublicService } from "./types.ts";

const service = (id: string, categoryId: string | null, categoryName: string | null): PublicService =>
  ({ id, name: id, description: null, durationMinutes: 30, price: 1000, currency: "RSD", categoryId, categoryName });

test("date keys move across month and year boundaries", () => {
  assert.equal(addDaysToDateKey("2026-11-30", 1), "2026-12-01");
  assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(getDayWindow("2026-11-06", 3), ["2026-11-06", "2026-11-07", "2026-11-08"]);
});

test("dates are written in Latin script", () => {
  assert.equal(formatDateLong("2026-11-09"), "Ponedeljak, 9. novembar");
  assert.deepEqual(getDayParts("2026-11-09"), { weekday: "Pon", day: 9, month: "NOV" });
  assert.equal(formatMonthYear("2026-11-09"), "Novembar 2026");
});

test("slots are grouped and formatted in the salon time zone", () => {
  const slot = (h: number) => ({ startTime: `2026-11-09T${String(h).padStart(2, "0")}:15:00.000Z`, endTime: `2026-11-09T${String(h + 1).padStart(2, "0")}:00:00.000Z`, employeeId: "e" });
  const { morning, afternoon } = groupSlotsByDayPart([slot(8), slot(10), slot(11), slot(13)], "Europe/Belgrade");
  assert.equal(morning.length, 2); // 09:15 and 11:15 Belgrade
  assert.equal(afternoon.length, 2); // 12:15 and 14:15 Belgrade
  assert.equal(formatTimeRange(slot(13), "Europe/Belgrade"), "14:15 – 15:00");
});

test("category filters only appear for at least two real categories", () => {
  assert.deepEqual(getServiceCategoryFilters([service("a", null, null), service("b", null, null)]), []);
  assert.deepEqual(getServiceCategoryFilters([service("a", "c1", "Kosa"), service("b", "c1", "Kosa")]), []);
  assert.deepEqual(getServiceCategoryFilters([service("a", "c1", "Kosa"), service("b", "c2", "Nokti"), service("c", null, null)]),
    [{ id: "c1", name: "Kosa" }, { id: "c2", name: "Nokti" }]);
});

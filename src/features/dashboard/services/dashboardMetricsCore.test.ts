import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDashboardSectionResult,
  computeTodayOccupancy,
  formatAppointmentStatus,
  getMonthRangeUtc,
  initialDashboardSection,
  type OccupancyWorkingHour,
} from "./dashboardMetricsCore.ts";

const TZ = "Europe/Belgrade";
const DATE = "2026-11-10"; // Tuesday, UTC+1
const hours = (overrides: Partial<OccupancyWorkingHour> = {}): OccupancyWorkingHour => ({
  employee_id: null, day_of_week: 2, opens_at: "09:00", closes_at: "17:00", break_starts_at: "12:00", break_ends_at: "13:00", is_working_day: true, ...overrides,
});
const employee = (id: string, extra: Partial<{ is_active: boolean; is_bookable: boolean }> = {}) => ({ id, is_active: true, is_bookable: true, ...extra });
const appointment = (employeeId: string, start: string, end: string, status = "confirmed") => ({ employee_id: employeeId, start_time: start, end_time: end, status });

test("month range follows the salon time zone, including year end", () => {
  const november = getMonthRangeUtc("2026-11-30", TZ);
  assert.equal(november.startUtc.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(november.endUtc.toISOString(), "2026-11-30T23:00:00.000Z");
  const december = getMonthRangeUtc("2026-12-05", TZ);
  assert.equal(december.endUtc.toISOString(), "2026-12-31T23:00:00.000Z");
  // March: start in winter time (UTC+1), end in summer time (UTC+2).
  const march = getMonthRangeUtc("2026-03-15", TZ);
  assert.equal(march.startUtc.toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(march.endUtc.toISOString(), "2026-03-31T22:00:00.000Z");
});

test("occupancy counts pending, confirmed and completed; not cancelled or no-show", () => {
  const result = computeTodayOccupancy({
    dateKey: DATE, timeZone: TZ, employees: [employee("a")], workingHours: [hours()], closures: [],
    appointments: [
      appointment("a", "2026-11-10T08:00:00Z", "2026-11-10T09:00:00Z", "confirmed"), // 09-10 local
      appointment("a", "2026-11-10T09:00:00Z", "2026-11-10T10:00:00Z", "cancelled"),
      appointment("a", "2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z", "no_show"),
      appointment("a", "2026-11-10T14:00:00Z", "2026-11-10T14:30:00Z", "completed"),
      appointment("a", "2026-11-10T15:00:00Z", "2026-11-10T15:30:00Z", "pending"),
    ],
  });
  assert.equal(result.availableMinutes, 7 * 60); // 8 h minus 1 h break
  assert.equal(result.occupiedMinutes, 120);
  assert.equal(result.percent, 29);
});

test("only active employees who accept bookings, with their own hours or the salon default", () => {
  const result = computeTodayOccupancy({
    dateKey: DATE, timeZone: TZ,
    employees: [employee("a"), employee("inactive", { is_active: false }), employee("not-bookable", { is_bookable: false }), employee("own")],
    workingHours: [hours(), hours({ employee_id: "own", opens_at: "10:00", closes_at: "14:00", break_starts_at: null, break_ends_at: null }), hours({ day_of_week: 3, opens_at: "08:00" })],
    closures: [],
    appointments: [appointment("inactive", "2026-11-10T08:00:00Z", "2026-11-10T09:00:00Z")],
  });
  assert.equal(result.availableMinutes, 7 * 60 + 4 * 60);
  assert.equal(result.occupiedMinutes, 0);
});

test("closures and absences reduce working time; appointments outside working time and overlaps are not double counted", () => {
  const result = computeTodayOccupancy({
    dateKey: DATE, timeZone: TZ, employees: [employee("a"), employee("b")],
    workingHours: [hours()],
    closures: [
      { employee_id: "b", starts_at: "2026-11-09T23:00:00Z", ends_at: "2026-11-10T23:00:00Z" }, // b absent all day
      { employee_id: null, starts_at: "2026-11-10T14:00:00Z", ends_at: "2026-11-10T16:00:00Z" }, // salon closed 15-17
    ],
    appointments: [
      appointment("a", "2026-11-10T07:00:00Z", "2026-11-10T09:00:00Z"), // 08-10 local, only 09-10 counts
      appointment("a", "2026-11-10T08:30:00Z", "2026-11-10T09:30:00Z"), // overlaps, adds 10:00-10:30
      appointment("b", "2026-11-10T09:00:00Z", "2026-11-10T10:00:00Z"),
    ],
  });
  assert.equal(result.availableMinutes, 5 * 60); // a: 09-12, 13-15
  assert.equal(result.occupiedMinutes, 90);
  assert.equal(result.percent, 30);
});

test("closed salon or day off gives no percentage instead of 0%", () => {
  const dayOff = computeTodayOccupancy({ dateKey: DATE, timeZone: TZ, employees: [employee("a")], workingHours: [hours({ is_working_day: false })], closures: [], appointments: [] });
  assert.deepEqual(dayOff, { availableMinutes: 0, occupiedMinutes: 0, percent: null });
  const noHours = computeTodayOccupancy({ dateKey: DATE, timeZone: TZ, employees: [employee("a")], workingHours: [], closures: [], appointments: [] });
  assert.equal(noHours.percent, null);
  const noEmployees = computeTodayOccupancy({ dateKey: DATE, timeZone: TZ, employees: [], workingHours: [hours()], closures: [], appointments: [] });
  assert.equal(noEmployees.percent, null);
  const working = computeTodayOccupancy({ dateKey: DATE, timeZone: TZ, employees: [employee("a")], workingHours: [hours()], closures: [], appointments: [] });
  assert.equal(working.percent, 0, "a working day without bookings is a real 0%");
});

test("section state: loading, empty success, first failure, stale after failed refresh", () => {
  const loading = initialDashboardSection<number[]>();
  assert.equal(loading.status, "loading");
  const empty = applyDashboardSectionResult(loading, { status: "fulfilled", value: [] });
  assert.deepEqual(empty, { status: "ready", data: [], stale: false });
  const firstFailure = applyDashboardSectionResult(initialDashboardSection<number[]>(), { status: "rejected" });
  assert.deepEqual(firstFailure, { status: "error", data: null, stale: false });
  const loaded = applyDashboardSectionResult(loading, { status: "fulfilled", value: [3] });
  const failedRefresh = applyDashboardSectionResult(loaded, { status: "rejected" });
  assert.deepEqual(failedRefresh, { status: "error", data: [3], stale: true });
  assert.deepEqual(applyDashboardSectionResult(failedRefresh, { status: "fulfilled", value: [4] }), { status: "ready", data: [4], stale: false });
});

test("appointment statuses are translated", () => {
  assert.equal(formatAppointmentStatus("confirmed"), "Potvrđeno");
  assert.equal(formatAppointmentStatus("no_show"), "Nije došao");
});

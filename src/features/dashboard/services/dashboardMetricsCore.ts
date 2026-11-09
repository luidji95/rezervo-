import { getDayOfWeekFromDateKey, getDayRangeUtc, zonedDateTimeToUtc } from "../../../lib/salonDateTime.ts";

// Pure Dashboard metrics. Every value is derived from salon data; nothing here invents numbers.

// Appointments that count as today's work: booked or done. Cancelled and no-show do not.
export const DASHBOARD_COUNTED_STATUSES = ["pending", "confirmed", "completed"] as const;

// Calendar month of the given salon-local date, as UTC instants [start, end).
export function getMonthRangeUtc(dateKey: string, timeZone: string) {
  const [year, month] = dateKey.split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextFirst = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { startUtc: zonedDateTimeToUtc(first, "00:00:00", timeZone), endUtc: zonedDateTimeToUtc(nextFirst, "00:00:00", timeZone) };
}

type Interval = { start: number; end: number };

function mergeIntervals(intervals: Interval[]) {
  const sorted = intervals.filter((item) => item.end > item.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const item of sorted) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  return merged;
}

function subtract(windows: Interval[], blocked: Interval[]) {
  let result = windows;
  for (const block of mergeIntervals(blocked)) {
    result = result.flatMap((window) => {
      if (block.end <= window.start || block.start >= window.end) return [window];
      const parts: Interval[] = [];
      if (block.start > window.start) parts.push({ start: window.start, end: block.start });
      if (block.end < window.end) parts.push({ start: block.end, end: window.end });
      return parts;
    });
  }
  return result;
}

function intersect(windows: Interval[], items: Interval[]) {
  const pieces: Interval[] = [];
  for (const item of items) {
    for (const window of windows) {
      const start = Math.max(item.start, window.start);
      const end = Math.min(item.end, window.end);
      if (end > start) pieces.push({ start, end });
    }
  }
  return mergeIntervals(pieces);
}

const minutes = (intervals: Interval[]) => intervals.reduce((sum, item) => sum + (item.end - item.start), 0) / 60_000;

export type OccupancyEmployee = { id: string; is_active: boolean; is_bookable: boolean };
export type OccupancyWorkingHour = {
  employee_id: string | null;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
  is_working_day: boolean;
};
export type OccupancyClosure = { employee_id: string | null; starts_at: string; ends_at: string };
export type OccupancyAppointment = { employee_id: string | null; start_time: string; end_time: string; status: string };

export type TodayOccupancy = {
  availableMinutes: number;
  occupiedMinutes: number;
  // null when nobody works today (closed salon, day off, everyone absent): a percentage would be meaningless.
  percent: number | null;
};

// Occupancy today = booked time inside working time / working time, per active employee who accepts bookings.
// Working time is the employee's own hours for the salon-local weekday (else the salon default), minus the break and
// minus salon-wide and personal closures. Booked time counts pending, confirmed and completed appointments of that
// employee, clipped to the working time and without double-counting overlaps.
export function computeTodayOccupancy(input: {
  dateKey: string;
  timeZone: string;
  employees: OccupancyEmployee[];
  workingHours: OccupancyWorkingHour[];
  closures: OccupancyClosure[];
  appointments: OccupancyAppointment[];
}): TodayOccupancy {
  const { dateKey, timeZone } = input;
  const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
  const day = getDayRangeUtc(dateKey, timeZone);
  const dayWindow = { start: day.startUtc.getTime(), end: day.endUtc.getTime() };
  const at = (time: string) => zonedDateTimeToUtc(dateKey, time, timeZone).getTime();
  const counted = new Set<string>(DASHBOARD_COUNTED_STATUSES);
  const salonDefault = input.workingHours.find((hours) => hours.employee_id === null && hours.day_of_week === dayOfWeek);

  let available = 0;
  let occupied = 0;
  for (const employee of input.employees) {
    if (!employee.is_active || !employee.is_bookable) continue;
    const hours = input.workingHours.find((item) => item.employee_id === employee.id && item.day_of_week === dayOfWeek) ?? salonDefault;
    if (!hours || !hours.is_working_day) continue;
    let windows: Interval[] = [{ start: at(hours.opens_at), end: at(hours.closes_at) }];
    if (hours.break_starts_at && hours.break_ends_at) windows = subtract(windows, [{ start: at(hours.break_starts_at), end: at(hours.break_ends_at) }]);
    const closures = input.closures
      .filter((closure) => closure.employee_id === null || closure.employee_id === employee.id)
      .map((closure) => ({ start: new Date(closure.starts_at).getTime(), end: new Date(closure.ends_at).getTime() }));
    windows = intersect(subtract(windows, closures), [dayWindow]);
    const booked = input.appointments
      .filter((appointment) => appointment.employee_id === employee.id && counted.has(appointment.status))
      .map((appointment) => ({ start: new Date(appointment.start_time).getTime(), end: new Date(appointment.end_time).getTime() }));
    available += minutes(windows);
    occupied += minutes(intersect(windows, booked));
  }
  return {
    availableMinutes: Math.round(available),
    occupiedMinutes: Math.round(occupied),
    percent: available > 0 ? Math.round((occupied / available) * 100) : null,
  };
}

// Per-section state of the Dashboard: loading, loaded (also an empty success) or failed. A failed refresh keeps the
// last successful data and marks it stale, so it can be labelled as previously loaded.
export type DashboardSection<T> =
  | { status: "loading"; data: null; stale: false }
  | { status: "ready"; data: T; stale: false }
  | { status: "error"; data: T | null; stale: boolean };

export function initialDashboardSection<T>(): DashboardSection<T> {
  return { status: "loading", data: null, stale: false };
}

export function applyDashboardSectionResult<T>(
  previous: DashboardSection<T>,
  result: { status: "fulfilled"; value: T } | { status: "rejected" },
): DashboardSection<T> {
  if (result.status === "fulfilled") return { status: "ready", data: result.value, stale: false };
  return previous.data === null
    ? { status: "error", data: null, stale: false }
    : { status: "error", data: previous.data, stale: true };
}

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Na čekanju",
  confirmed: "Potvrđeno",
  completed: "Završeno",
  cancelled: "Otkazano",
  no_show: "Nije došao",
};

export function formatAppointmentStatus(status: string) {
  return APPOINTMENT_STATUS_LABELS[status] ?? status;
}

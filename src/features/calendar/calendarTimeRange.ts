import {
  getDateKeyInTimeZone,
  getDayOfWeekFromDateKey,
} from "../../lib/salonDateTime.ts";

export const CALENDAR_HOUR_HEIGHT = 112;
const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_START_MINUTE = 8 * 60;
const DEFAULT_END_MINUTE = 21 * 60;

type CalendarWorkingHour = {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_working_day: boolean;
};

type CalendarRangeAppointment = {
  start_time: string;
  end_time: string;
  status?: string;
};

export type CalendarVisibleRange = {
  startMinute: number;
  endMinute: number;
  hourLabels: string[];
};

function parseTimeMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function floorToHour(minutes: number) {
  return Math.floor(minutes / 60) * 60;
}

function ceilToHour(minutes: number) {
  return Math.ceil(minutes / 60) * 60;
}

function dateKeyDistance(first: string, second: string) {
  const firstTime = Date.parse(`${first}T00:00:00.000Z`);
  const secondTime = Date.parse(`${second}T00:00:00.000Z`);
  return Math.round((firstTime - secondTime) / 86_400_000);
}

export function getCalendarLocalMinutes(
  instant: string | Date,
  selectedDate: string,
  timeZone: string,
) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const dateKey = getDateKeyInTimeZone(date, timeZone);
  const dayOffset = dateKeyDistance(dateKey, selectedDate);
  return dayOffset * MINUTES_PER_DAY + Number(parts.hour) * 60 + Number(parts.minute);
}

function formatHourLabel(minutes: number) {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:00`;
}

export function deriveCalendarVisibleRange(input: {
  selectedDate: string;
  timeZone: string;
  workingHours: CalendarWorkingHour[];
  appointments: CalendarRangeAppointment[];
}): CalendarVisibleRange {
  const weekday = getDayOfWeekFromDateKey(input.selectedDate);
  const dayHours = input.workingHours.find(
    (hours) => hours.day_of_week === weekday && hours.is_working_day,
  );
  const configuredStart = dayHours ? parseTimeMinutes(dayHours.opens_at) : null;
  const configuredEnd = dayHours ? parseTimeMinutes(dayHours.closes_at) : null;

  const appointmentStarts = input.appointments
    .map((appointment) => getCalendarLocalMinutes(appointment.start_time, input.selectedDate, input.timeZone))
    .filter((value): value is number => value !== null);
  const appointmentEnds = input.appointments
    .map((appointment) => getCalendarLocalMinutes(appointment.end_time, input.selectedDate, input.timeZone))
    .filter((value): value is number => value !== null);

  const candidatesStart = [configuredStart ?? DEFAULT_START_MINUTE, ...appointmentStarts].filter(
    (value): value is number => value !== null,
  );
  const candidatesEnd = [configuredEnd ?? DEFAULT_END_MINUTE, ...appointmentEnds].filter(
    (value): value is number => value !== null,
  );

  const rawStart = candidatesStart.length ? Math.min(...candidatesStart) : DEFAULT_START_MINUTE;
  const rawEnd = candidatesEnd.length ? Math.max(...candidatesEnd) : DEFAULT_END_MINUTE;
  const startMinute = Math.max(0, Math.min(floorToHour(rawStart), MINUTES_PER_DAY - 60));
  const endMinute = Math.min(
    MINUTES_PER_DAY,
    Math.max(ceilToHour(rawEnd), startMinute + 60),
  );
  const hourLabels: string[] = [];
  for (let minute = startMinute; minute < endMinute; minute += 60) {
    hourLabels.push(formatHourLabel(minute));
  }

  return { startMinute, endMinute, hourLabels };
}

export function calculateCalendarItemTop(
  startTime: string,
  selectedDate: string,
  timeZone: string,
  rangeStartMinute: number,
) {
  const localMinutes = getCalendarLocalMinutes(startTime, selectedDate, timeZone);
  if (localMinutes === null) return 0;
  return ((localMinutes - rangeStartMinute) / 60) * CALENDAR_HOUR_HEIGHT;
}

export function calculateCurrentTimeLineTop(
  currentTime: Date,
  selectedDate: string,
  timeZone: string,
  range: Pick<CalendarVisibleRange, "startMinute" | "endMinute">,
) {
  if (getDateKeyInTimeZone(currentTime, timeZone) !== selectedDate) return null;
  const localMinutes = getCalendarLocalMinutes(currentTime, selectedDate, timeZone);
  if (localMinutes === null || localMinutes < range.startMinute || localMinutes >= range.endMinute) {
    return null;
  }
  return ((localMinutes - range.startMinute) / 60) * CALENDAR_HOUR_HEIGHT;
}

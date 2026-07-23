import "server-only";

import {
  addDaysToDateKey,
  getDayRangeUtc,
  getTodayDateKey,
} from "@/lib/salonDateTime";
import type {
  StatisticsGranularity,
  StatisticsPeriodInput,
  StatisticsPreset,
} from "@/features/statistics/types";

const MAX_CUSTOM_DAYS = 1096;

function dateKeyToUtcDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(year: number, monthIndex: number, day: number) {
  const value = new Date(Date.UTC(year, monthIndex, day));
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function monthStart(dateKeyValue: string, offset: number) {
  const date = dateKeyToUtcDate(dateKeyValue);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
}

function yearStart(dateKeyValue: string, offset: number) {
  const date = dateKeyToUtcDate(dateKeyValue);
  return dateKey(date.getUTCFullYear() + offset, 0, 1);
}

function differenceInDays(start: string, endExclusive: string) {
  return Math.round(
    (dateKeyToUtcDate(endExclusive).getTime() - dateKeyToUtcDate(start).getTime()) /
      86_400_000,
  );
}

const LABELS: Record<StatisticsPreset, string> = {
  today: "Danas",
  last_7_days: "Poslednjih 7 dana",
  this_month: "Ovaj mesec",
  previous_month: "Prethodni mesec",
  last_3_months: "Poslednja 3 meseca",
  this_year: "Ova godina",
  custom: "Izabrani period",
};

export class InvalidStatisticsPeriodError extends Error {
  constructor() {
    super("INVALID_PERIOD");
    this.name = "InvalidStatisticsPeriodError";
  }
}

export function buildStatisticsPeriod(
  input: StatisticsPeriodInput,
  timeZone: string,
  now = new Date(),
) {
  const today = getTodayDateKey(timeZone, now);
  let startDate: string;
  let endDateExclusive: string;

  switch (input.preset) {
    case "today":
      startDate = today;
      endDateExclusive = addDaysToDateKey(today, 1);
      break;
    case "last_7_days":
      startDate = addDaysToDateKey(today, -6);
      endDateExclusive = addDaysToDateKey(today, 1);
      break;
    case "this_month":
      startDate = monthStart(today, 0);
      endDateExclusive = monthStart(today, 1);
      break;
    case "previous_month":
      startDate = monthStart(today, -1);
      endDateExclusive = monthStart(today, 0);
      break;
    case "last_3_months":
      startDate = monthStart(today, -2);
      endDateExclusive = monthStart(today, 1);
      break;
    case "this_year":
      startDate = yearStart(today, 0);
      endDateExclusive = yearStart(today, 1);
      break;
    case "custom":
      if (!input.customStart || !input.customEnd) {
        throw new InvalidStatisticsPeriodError();
      }
      startDate = input.customStart;
      endDateExclusive = addDaysToDateKey(input.customEnd, 1);
      break;
  }

  const days = differenceInDays(startDate, endDateExclusive);
  if (days < 1 || days > MAX_CUSTOM_DAYS) {
    throw new InvalidStatisticsPeriodError();
  }

  const startUtc = getDayRangeUtc(startDate, timeZone).startUtc;
  const endUtc = getDayRangeUtc(endDateExclusive, timeZone).startUtc;
  const granularity: StatisticsGranularity = days <= 31 ? "day" : "month";

  return {
    preset: input.preset,
    dateKeyStart: startDate,
    dateKeyEndExclusive: endDateExclusive,
    startUtc,
    endUtc,
    label: LABELS[input.preset],
    bucketGranularity: granularity,
  };
}

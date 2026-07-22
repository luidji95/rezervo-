export const DEFAULT_SALON_TIME_ZONE = "Europe/Belgrade";

type DateKeyParts = {
  year: number;
  month: number;
  day: number;
};

function getFormatter(timeZone: string, includeTime = false) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23" as const,
        }
      : {}),
  });
}

function getPartsMap(date: Date, timeZone: string, includeTime = false) {
  return Object.fromEntries(
    getFormatter(timeZone, includeTime)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
}

function parseDateKey(dateKey: string): DateKeyParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);

  if (!match) throw new Error("Invalid date key.");

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const validationDate = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  );

  if (
    validationDate.getUTCFullYear() !== parts.year ||
    validationDate.getUTCMonth() !== parts.month - 1 ||
    validationDate.getUTCDate() !== parts.day
  ) {
    throw new Error("Invalid calendar date.");
  }

  return parts;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getPartsMap(date, timeZone, true);
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const wholeSecondInstant = Math.floor(date.getTime() / 1000) * 1000;

  return representedAsUtc - wholeSecondInstant;
}

export function getDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = getPartsMap(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getTodayDateKey(
  timeZone = DEFAULT_SALON_TIME_ZONE,
  now = new Date(),
) {
  return getDateKeyInTimeZone(now, timeZone);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function zonedDateTimeToUtc(
  dateKey: string,
  time: string,
  timeZone = DEFAULT_SALON_TIME_ZONE,
) {
  const { year, month, day } = parseDateKey(dateKey);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);

  if (!timeMatch) throw new Error("Invalid time value.");

  const localAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    Number(timeMatch[3] ?? 0),
  );
  let result = localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone);

  // Recalculate at the resulting instant so DST transitions use the real offset.
  result = localAsUtc - getTimeZoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

export function getDayRangeUtc(
  dateKey: string,
  timeZone = DEFAULT_SALON_TIME_ZONE,
) {
  const nextDateKey = addDaysToDateKey(dateKey, 1);
  return {
    startUtc: zonedDateTimeToUtc(dateKey, "00:00:00", timeZone),
    endUtc: zonedDateTimeToUtc(nextDateKey, "00:00:00", timeZone),
  };
}

export function getHourInTimeZone(date: Date, timeZone: string) {
  return Number(getPartsMap(date, timeZone, true).hour);
}

export function getDayOfWeekFromDateKey(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

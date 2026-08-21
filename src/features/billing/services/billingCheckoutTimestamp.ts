const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export function parseBillingCheckoutTimestampInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, offsetHourRaw, offsetMinuteRaw] = match;
  const year = Number(yearRaw), month = Number(monthRaw), day = Number(dayRaw);
  const hour = Number(hourRaw), minute = Number(minuteRaw), second = Number(secondRaw);
  const offsetHour = offsetHourRaw === undefined ? 0 : Number(offsetHourRaw);
  const offsetMinute = offsetMinuteRaw === undefined ? 0 : Number(offsetMinuteRaw);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]! ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

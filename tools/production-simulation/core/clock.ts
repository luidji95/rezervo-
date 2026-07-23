const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) throw new Error("Anchor date must use YYYY-MM-DD format.");

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error("Anchor date is not a valid calendar date.");
  }

  return value;
}

export function subtractMonths(dateKey: string, months: number) {
  assertDateKey(dateKey);
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const result = new Date(
    Date.UTC(
      targetMonth.getUTCFullYear(),
      targetMonth.getUTCMonth(),
      Math.min(day, lastDay),
    ),
  );

  return result.toISOString().slice(0, 10);
}

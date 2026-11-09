import { addDaysToDateKey } from "../../lib/salonDateTime.ts";
import type { StatisticsGranularity } from "./types.ts";

export type TrendPoint = { bucket: string; revenue: number; completedAppointments: number };

// The database returns only buckets with completed appointments. After a successful query every day (or month) of
// the period is shown: buckets without completed appointments get 0 revenue and 0 completed appointments.
export function fillStatisticsTrend(
  trend: TrendPoint[],
  period: { dateKeyStart: string; dateKeyEndExclusive: string; granularity: StatisticsGranularity },
): TrendPoint[] {
  const byBucket = new Map(trend.map((point) => [point.bucket, point]));
  const buckets: string[] = [];
  if (period.granularity === "day") {
    for (let key = period.dateKeyStart; key < period.dateKeyEndExclusive; key = addDaysToDateKey(key, 1)) buckets.push(key);
  } else {
    const last = addDaysToDateKey(period.dateKeyEndExclusive, -1).slice(0, 7);
    let [year, month] = period.dateKeyStart.slice(0, 7).split("-").map(Number);
    for (;;) {
      const bucket = `${year}-${String(month).padStart(2, "0")}`;
      buckets.push(bucket);
      if (bucket >= last) break;
      month += 1;
      if (month === 13) { month = 1; year += 1; }
    }
  }
  return buckets.map((bucket) => {
    const point = byBucket.get(bucket);
    return { bucket, revenue: Number(point?.revenue ?? 0), completedAppointments: Number(point?.completedAppointments ?? 0) };
  });
}

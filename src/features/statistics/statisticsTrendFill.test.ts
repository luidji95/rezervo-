import assert from "node:assert/strict";
import test from "node:test";
import { fillStatisticsTrend } from "./statisticsTrendFill.ts";

test("days without completed appointments between two busy days get zeros", () => {
  const filled = fillStatisticsTrend(
    [{ bucket: "2026-11-02", revenue: 40, completedAppointments: 2 }, { bucket: "2026-11-05", revenue: 15, completedAppointments: 1 }],
    { dateKeyStart: "2026-11-01", dateKeyEndExclusive: "2026-11-07", granularity: "day" },
  );
  assert.deepEqual(filled.map((point) => `${point.bucket}:${point.revenue}:${point.completedAppointments}`), [
    "2026-11-01:0:0", "2026-11-02:40:2", "2026-11-03:0:0", "2026-11-04:0:0", "2026-11-05:15:1", "2026-11-06:0:0",
  ]);
});

test("empty successful result fills the whole period with zeros", () => {
  const filled = fillStatisticsTrend([], { dateKeyStart: "2026-10-30", dateKeyEndExclusive: "2026-11-02", granularity: "day" });
  assert.deepEqual(filled.map((point) => point.bucket), ["2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.ok(filled.every((point) => point.revenue === 0 && point.completedAppointments === 0));
});

test("month buckets cover every month of the period, across a year end", () => {
  const filled = fillStatisticsTrend(
    [{ bucket: "2026-12", revenue: 100, completedAppointments: 5 }],
    { dateKeyStart: "2026-11-01", dateKeyEndExclusive: "2027-03-01", granularity: "month" },
  );
  assert.deepEqual(filled.map((point) => `${point.bucket}:${point.revenue}`), ["2026-11:0", "2026-12:100", "2027-01:0", "2027-02:0"]);
});

test("numeric strings from the database become numbers", () => {
  const [point] = fillStatisticsTrend(
    [{ bucket: "2026-11-01", revenue: "12.50" as unknown as number, completedAppointments: "3" as unknown as number }],
    { dateKeyStart: "2026-11-01", dateKeyEndExclusive: "2026-11-02", granularity: "day" },
  );
  assert.deepEqual(point, { bucket: "2026-11-01", revenue: 12.5, completedAppointments: 3 });
});

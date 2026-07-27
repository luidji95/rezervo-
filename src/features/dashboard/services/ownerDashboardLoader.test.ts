import assert from "node:assert/strict";
import test from "node:test";
import { loadOwnerDashboardSections } from "./ownerDashboardLoader.ts";

function factories(overrides: Partial<Record<string, () => Promise<unknown>>> = {}) {
  const resolved = (value: unknown) => async () => value;
  return {
    stats: resolved({ total: 1 }),
    todaySchedule: resolved([]),
    upcomingAppointments: resolved([]),
    employees: resolved([]),
    popularServices: resolved([]),
    topClients: resolved([]),
    ...overrides,
  };
}

test("one failed KPI does not discard or indefinitely load other sections", async () => {
  const result = await loadOwnerDashboardSections(factories({
    topClients: async () => { throw new Error("query failed"); },
  }));
  assert.equal(result.stats.status, "fulfilled");
  assert.equal(result.topClients.status, "rejected");
});

test("a stalled secondary request is bounded and every request starts once", async () => {
  let calls = 0;
  const tracked = Object.fromEntries(Object.entries(factories({
    popularServices: () => new Promise(() => undefined),
  })).map(([name, factory]) => [name, async () => { calls += 1; return factory(); }]));
  const result = await loadOwnerDashboardSections(
    tracked as ReturnType<typeof factories>,
    { timeoutMs: 5 },
  );
  assert.equal(calls, 6);
  assert.deepEqual(result.popularServices, {
    status: "rejected",
    errorCode: "REQUEST_TIMEOUT",
    durationMs: result.popularServices.durationMs,
  });
});

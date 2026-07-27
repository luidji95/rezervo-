export type DashboardSectionName =
  | "stats"
  | "todaySchedule"
  | "upcomingAppointments"
  | "employees"
  | "popularServices"
  | "topClients";

export type DashboardSectionResult<T> =
  | { status: "fulfilled"; value: T; durationMs: number }
  | { status: "rejected"; errorCode: "REQUEST_FAILED" | "REQUEST_TIMEOUT"; durationMs: number };

type DashboardFactories<T extends Record<DashboardSectionName, unknown>> = {
  [K in keyof T]: () => Promise<T[K]>;
};

export async function loadOwnerDashboardSections<
  T extends Record<DashboardSectionName, unknown>,
>(
  factories: DashboardFactories<T>,
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<{ [K in keyof T]: DashboardSectionResult<T[K]> }> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? (() => performance.now());

  const entries = Object.entries(factories) as Array<
    [keyof T, () => Promise<T[keyof T]>]
  >;
  const results = await Promise.all(
    entries.map(async ([name, factory]) => {
      const startedAt = now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          factory(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("DASHBOARD_REQUEST_TIMEOUT")), timeoutMs);
          }),
        ]);
        return [name, { status: "fulfilled", value, durationMs: Math.max(0, now() - startedAt) }] as const;
      } catch (error) {
        return [name, {
          status: "rejected",
          errorCode: error instanceof Error && error.message === "DASHBOARD_REQUEST_TIMEOUT"
            ? "REQUEST_TIMEOUT" as const
            : "REQUEST_FAILED" as const,
          durationMs: Math.max(0, now() - startedAt),
        }] as const;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }),
  );

  return Object.fromEntries(results) as { [K in keyof T]: DashboardSectionResult<T[K]> };
}

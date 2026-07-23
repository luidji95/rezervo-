import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addDaysToDateKey,
  getDayRangeUtc,
} from "../../../src/lib/salonDateTime.ts";
import type { SimulationManifest } from "../core/manifest.ts";

type StatisticsAppointment = {
  id: string;
  client_id: string | null;
  employee_id: string | null;
  status: string;
  price: number | null;
  booking_source: string | null;
  start_time: string;
  clients: { full_name: string } | null;
  appointment_services: Array<{
    service_id: string | null;
    service_name_snapshot: string;
    price_snapshot: number;
  }>;
};

function monthStart(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

async function fetchPeriodAppointments(input: {
  supabase: SupabaseClient;
  salonId: string;
  startUtc: string;
  endUtc: string;
}) {
  const rows: StatisticsAppointment[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await input.supabase
      .from("appointments")
      .select("id,client_id,employee_id,status,price,booking_source,start_time,clients(full_name),appointment_services(service_id,service_name_snapshot,price_snapshot)")
      .eq("salon_id", input.salonId)
      .gte("start_time", input.startUtc)
      .lt("start_time", input.endUtc)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Statistics oracle query failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as StatisticsAppointment[]));
    if ((data ?? []).length < 1_000) break;
  }
  return rows;
}

function mapCounts(entries: Array<{ source: string; count: number }>) {
  return Object.fromEntries(
    entries
      .map((entry) => [entry.source, Number(entry.count)] as const)
      .sort(([first], [second]) => first.localeCompare(second)),
  );
}

function sortedRecord(value: Record<string, number>) {
  return Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second)));
}

function compareNumbers(actual: number, expected: number, tolerance = 0.01) {
  return Math.abs(actual - expected) <= tolerance;
}

async function validatePeriod(input: {
  supabase: SupabaseClient;
  salonId: string;
  timezone: string;
  label: string;
  startDate: string;
  endDate: string;
}) {
  const startedAt = performance.now();
  const startUtc = getDayRangeUtc(input.startDate, input.timezone).startUtc.toISOString();
  const endUtc = getDayRangeUtc(input.endDate, input.timezone).startUtc.toISOString();
  const days = Math.round((Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) / 86_400_000);
  const [{ data: rpc, error }, appointments] = await Promise.all([
    input.supabase.rpc("get_owner_statistics_v1", {
      p_salon_id: input.salonId,
      p_start_utc: startUtc,
      p_end_utc: endUtc,
      p_granularity: days <= 31 ? "day" : "month",
    }),
    fetchPeriodAppointments({
      supabase: input.supabase,
      salonId: input.salonId,
      startUtc,
      endUtc,
    }),
  ]);
  if (error || !rpc) throw new Error(`Statistics RPC failed for ${input.label}: ${error?.message ?? "no data"}`);

  const completed = appointments.filter((appointment) => appointment.status === "completed");
  const noShow = appointments.filter((appointment) => appointment.status === "no_show").length;
  const revenue = completed.reduce((sum, appointment) => sum + Number(appointment.price ?? 0), 0);
  const sources: Record<string, number> = {};
  const services = new Map<string, { count: number; revenue: number }>();
  const employees = new Map<string, { completed: number; confirmed: number; cancelled: number; noShow: number; revenue: number }>();
  const clients = new Map<string, { name: string; visits: number; revenue: number }>();

  for (const appointment of appointments) {
    const source = appointment.booking_source ?? "unknown";
    sources[source] = (sources[source] ?? 0) + 1;
    const employeeKey = appointment.employee_id ?? "unknown";
    const employee = employees.get(employeeKey) ?? { completed: 0, confirmed: 0, cancelled: 0, noShow: 0, revenue: 0 };
    if (appointment.status === "completed") {
      employee.completed += 1;
      employee.revenue += Number(appointment.price ?? 0);
      if (appointment.client_id) {
        const client = clients.get(appointment.client_id) ?? {
          name: appointment.clients?.full_name ?? "Nepoznat klijent",
          visits: 0,
          revenue: 0,
        };
        client.visits += 1;
        client.revenue += Number(appointment.price ?? 0);
        clients.set(appointment.client_id, client);
      }
      for (const snapshot of appointment.appointment_services ?? []) {
        const key = snapshot.service_id ?? `snapshot:${snapshot.service_name_snapshot.toLowerCase()}`;
        const service = services.get(key) ?? { count: 0, revenue: 0 };
        service.count += 1;
        service.revenue += Number(snapshot.price_snapshot);
        services.set(key, service);
      }
    } else if (appointment.status === "confirmed") employee.confirmed += 1;
    else if (appointment.status === "cancelled") employee.cancelled += 1;
    else if (appointment.status === "no_show") employee.noShow += 1;
    employees.set(employeeKey, employee);
  }

  const rpcValue = rpc as {
    overview: { completedRevenue: number; completedAppointments: number; noShowRate: number };
    appointments: { bySource: Array<{ source: string; count: number }> };
    services: Array<{ serviceKey: string; completedCount: number; revenue: number }>;
    employees: Array<{ employeeId: string | null; completed: number; confirmed: number; cancelled: number; noShow: number; revenue: number }>;
    clients: { topClients: Array<{ clientId: string | null; completedVisits: number; revenue: number }> };
  };
  const expectedNoShowRate = completed.length + noShow === 0 ? 0 : Number((noShow * 100 / (completed.length + noShow)).toFixed(2));
  const failures: string[] = [];
  if (!compareNumbers(Number(rpcValue.overview.completedRevenue), revenue)) failures.push("completedRevenue");
  if (Number(rpcValue.overview.completedAppointments) !== completed.length) failures.push("completedAppointments");
  if (!compareNumbers(Number(rpcValue.overview.noShowRate), expectedNoShowRate)) failures.push("noShowRate");
  if (JSON.stringify(mapCounts(rpcValue.appointments.bySource)) !== JSON.stringify(sortedRecord(sources))) failures.push("bookingSources");

  for (const service of rpcValue.services) {
    const expected = services.get(service.serviceKey);
    if (!expected || expected.count !== Number(service.completedCount) || !compareNumbers(expected.revenue, Number(service.revenue))) {
      failures.push(`service:${service.serviceKey}`);
    }
  }
  for (const employee of rpcValue.employees) {
    const expected = employees.get(employee.employeeId ?? "unknown");
    if (!expected || expected.completed !== Number(employee.completed) || expected.confirmed !== Number(employee.confirmed) || expected.cancelled !== Number(employee.cancelled) || expected.noShow !== Number(employee.noShow) || !compareNumbers(expected.revenue, Number(employee.revenue))) {
      failures.push(`employee:${employee.employeeId ?? "unknown"}`);
    }
  }
  const rankedClients = [...clients.entries()]
    .sort(([, first], [, second]) =>
      second.revenue - first.revenue
      || second.visits - first.visits
      || first.name.localeCompare(second.name),
    );
  const expectedTopClientCount = Math.min(10, rankedClients.length);
  if (rpcValue.clients.topClients.length !== expectedTopClientCount) failures.push("topClientCount");
  const boundary = rankedClients[expectedTopClientCount - 1]?.[1];
  for (const actual of rpcValue.clients.topClients) {
    const clientId = actual.clientId ?? "unknown";
    const expected = clients.get(clientId);
    const actualRevenue = Number(actual.revenue);
    const actualVisits = Number(actual.completedVisits);
    const belowBoundary = boundary
      ? actualRevenue < boundary.revenue
        || (compareNumbers(actualRevenue, boundary.revenue) && actualVisits < boundary.visits)
      : false;
    if (!expected || actualVisits !== expected.visits || !compareNumbers(actualRevenue, expected.revenue) || belowBoundary) {
      failures.push(`topClient:${clientId}`);
    }
  }

  return {
    label: input.label,
    passed: failures.length === 0,
    failures,
    appointmentCount: appointments.length,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export async function validateStatistics(input: {
  supabase: SupabaseClient;
  manifest: SimulationManifest;
}) {
  const startedAt = performance.now();
  const periods = [
    {
      label: "full",
      startDate: input.manifest.dateRange.startDate,
      endDate: input.manifest.dateRange.endDate,
    },
    {
      label: "anchor_month",
      startDate: monthStart(input.manifest.dateRange.endDate),
      endDate: input.manifest.dateRange.endDate,
    },
    {
      label: "last_7_days",
      startDate: addDaysToDateKey(input.manifest.dateRange.endDate, -7),
      endDate: input.manifest.dateRange.endDate,
    },
  ];
  const results = [];
  for (const period of periods) {
    results.push(await validatePeriod({
      supabase: input.supabase,
      salonId: input.manifest.salon.id,
      timezone: input.manifest.salon.timezone,
      ...period,
    }));
  }
  return {
    passed: results.every((result) => result.passed),
    durationMs: Math.round(performance.now() - startedAt),
    periods: results,
  };
}

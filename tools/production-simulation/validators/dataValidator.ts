import type { SupabaseClient } from "@supabase/supabase-js";

import type { SimulationManifest } from "../core/manifest.ts";
import type { SimulationFoundation } from "../readers/foundationReader.ts";

const QUERY_BATCH_SIZE = 100;

async function fetchByIds(
  supabase: SupabaseClient,
  table: "clients" | "appointments",
  columns: string,
  ids: string[],
) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < ids.length; offset += QUERY_BATCH_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in("id", ids.slice(offset, offset + QUERY_BATCH_SIZE));
    if (error) throw new Error(`Validation query failed for ${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
  }
  return rows;
}

async function fetchSnapshots(supabase: SupabaseClient, appointmentIds: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < appointmentIds.length; offset += QUERY_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("appointment_services")
      .select("id,appointment_id,service_id,duration_minutes_snapshot,price_snapshot,sort_order")
      .in("appointment_id", appointmentIds.slice(offset, offset + QUERY_BATCH_SIZE));
    if (error) throw new Error(`Snapshot validation query failed: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return rows;
}

function normalizePhone(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/[\s()-]/g, "") : null;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

export async function validateSeededRun(input: {
  supabase: SupabaseClient;
  manifest: SimulationManifest;
  foundation: SimulationFoundation;
}) {
  const startedAt = performance.now();
  const clients = await fetchByIds(
    input.supabase,
    "clients",
    "id,salon_id,phone,email",
    input.manifest.plannedIds.clients,
  );
  const appointments = await fetchByIds(
    input.supabase,
    "appointments",
    "id,salon_id,client_id,employee_id,primary_service_id,start_time,end_time,duration_minutes,buffer_minutes,price,status,booking_source",
    input.manifest.plannedIds.appointments,
  );
  const snapshots = await fetchSnapshots(
    input.supabase,
    input.manifest.plannedIds.appointments,
  );
  const snapshotByAppointment = Map.groupBy(
    snapshots,
    (snapshot) => String(snapshot.appointment_id),
  );
  const assignments = new Map(
    input.foundation.assignments.map((assignment) => [
      `${assignment.employeeId}:${assignment.serviceId}`,
      assignment,
    ]),
  );
  const anomalies = {
    missingClients: input.manifest.planned.clients - clients.length,
    missingAppointments: input.manifest.planned.appointments - appointments.length,
    missingSnapshots: 0,
    orphanSnapshots: 0,
    multipleSnapshots: 0,
    overlaps: 0,
    duplicateContacts: 0,
    priceDurationMismatch: 0,
    invalidRelations: 0,
    statusBreakdownMismatch: 0,
    revenueMismatch: 0,
  };

  const appointmentIds = new Set(appointments.map((appointment) => String(appointment.id)));
  for (const snapshot of snapshots) {
    if (!appointmentIds.has(String(snapshot.appointment_id))) anomalies.orphanSnapshots += 1;
  }
  for (const appointment of appointments) {
    const related = snapshotByAppointment.get(String(appointment.id)) ?? [];
    if (related.length === 0) anomalies.missingSnapshots += 1;
    if (related.length > 1) anomalies.multipleSnapshots += 1;
    const snapshot = related[0];
    const assignment = assignments.get(
      `${String(appointment.employee_id)}:${String(appointment.primary_service_id)}`,
    );
    if (!assignment || appointment.salon_id !== input.manifest.salon.id) {
      anomalies.invalidRelations += 1;
    }
    if (
      !snapshot ||
      snapshot.service_id !== appointment.primary_service_id ||
      Number(snapshot.duration_minutes_snapshot) !== Number(appointment.duration_minutes) ||
      Number(snapshot.price_snapshot) !== Number(appointment.price) ||
      Number(snapshot.sort_order) !== 0
    ) {
      anomalies.priceDurationMismatch += 1;
    }
  }

  const appointmentsByEmployee = Map.groupBy(
    appointments,
    (appointment) => String(appointment.employee_id),
  );
  for (const employeeAppointments of appointmentsByEmployee.values()) {
    employeeAppointments.sort((first, second) =>
      String(first.start_time).localeCompare(String(second.start_time)),
    );
    for (let index = 1; index < employeeAppointments.length; index += 1) {
      if (
        new Date(String(employeeAppointments[index].start_time)) <
        new Date(String(employeeAppointments[index - 1].end_time))
      ) anomalies.overlaps += 1;
    }
  }

  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const client of clients) {
    const phone = normalizePhone(client.phone);
    const email = normalizeEmail(client.email);
    if ((phone && phones.has(phone)) || (email && emails.has(email))) {
      anomalies.duplicateContacts += 1;
    }
    if (phone) phones.add(phone);
    if (email) emails.add(email);
  }

  const actualStatus: Record<string, number> = {};
  let actualRevenue = 0;
  for (const appointment of appointments) {
    const status = String(appointment.status);
    actualStatus[status] = (actualStatus[status] ?? 0) + 1;
    if (status === "completed") actualRevenue += Number(appointment.price);
  }
  const orderedActualStatus = Object.fromEntries(
    Object.entries(actualStatus).sort(([first], [second]) => first.localeCompare(second)),
  );
  const orderedExpectedStatus = Object.fromEntries(
    Object.entries(input.manifest.statusBreakdown).sort(([first], [second]) => first.localeCompare(second)),
  );
  if (JSON.stringify(orderedActualStatus) !== JSON.stringify(orderedExpectedStatus)) {
    anomalies.statusBreakdownMismatch = 1;
  }
  if (Number(actualRevenue.toFixed(2)) !== input.manifest.expectedCompletedRevenue) {
    anomalies.revenueMismatch = 1;
  }

  return {
    passed: Object.values(anomalies).every((count) => count === 0),
    durationMs: Math.round(performance.now() - startedAt),
    counts: {
      clients: clients.length,
      appointments: appointments.length,
      snapshots: snapshots.length,
    },
    anomalies,
  };
}

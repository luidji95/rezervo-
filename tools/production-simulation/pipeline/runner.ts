import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  SIMULATION_PROFILES,
  SIMULATION_SCENARIO_VERSION,
  type SimulationProfileName,
} from "../config/profiles.ts";
import { subtractMonths } from "../core/clock.ts";
import { createRunIdentity, deterministicUuid } from "../core/ids.ts";
import {
  checksumManifest,
  getManifestPath,
  readManifest,
  saveManifest,
  type SimulationManifest,
} from "../core/manifest.ts";
import { generateSimulationPlan } from "./generator.ts";
import { readSimulationFoundation } from "../readers/foundationReader.ts";
import type { SimulationEnvironment } from "../validators/environmentValidator.ts";
import { validateSchemaCompatibility } from "../validators/schemaValidator.ts";

export const SIMULATION_BATCH_SIZE = 100;
const CLEANUP_QUERY_BATCH_SIZE = 100;

export type SimulationRunInput = {
  salonId: string;
  profile: SimulationProfileName;
  seed: string;
  anchorDate: string;
};

export function createSimulationSupabase(environment: SimulationEnvironment) {
  return createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

export async function prepareDryRun(
  environment: SimulationEnvironment,
  input: SimulationRunInput,
  options: { persist?: boolean } = {},
) {
  const supabase = createSimulationSupabase(environment);
  const schema = await validateSchemaCompatibility({
    supabase,
    supabaseUrl: environment.supabaseUrl,
    serviceRoleKey: environment.serviceRoleKey,
  });
  const foundation = await readSimulationFoundation(supabase, input.salonId);
  const profile = SIMULATION_PROFILES[input.profile];
  const identity = createRunIdentity({
    ...input,
    scenarioVersion: SIMULATION_SCENARIO_VERSION,
  });
  const runId = deterministicUuid(`run:${identity}`);
  const dateRange = {
    startDate: subtractMonths(input.anchorDate, profile.historyMonths),
    endDate: input.anchorDate,
  };
  const plan = await generateSimulationPlan({
    supabase,
    foundation,
    identity,
    clientsCount: profile.clients,
    appointmentsCount: profile.appointments,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    allowedBookingSources: schema.bookingSources,
    batchSize: SIMULATION_BATCH_SIZE,
  });
  const statusBreakdown: Record<string, number> = {};
  const bookingSourceBreakdown: Record<string, number> = {};
  let completedRevenue = 0;
  for (const appointment of plan.appointments) {
    increment(statusBreakdown, appointment.status);
    increment(bookingSourceBreakdown, appointment.booking_source);
    if (appointment.status === "completed") completedRevenue += appointment.price;
  }

  const noShowCount = statusBreakdown.no_show ?? 0;
  const completedCount = statusBreakdown.completed ?? 0;
  const withoutChecksum = {
    mode: "dry-run" as const,
    runId,
    scenarioVersion: SIMULATION_SCENARIO_VERSION,
    seed: input.seed,
    profile: input.profile,
    salon: foundation.salon,
    planned: {
      clients: profile.clients,
      appointments: profile.appointments,
      appointmentServices: profile.appointments,
      notifications: 0 as const,
      batches: plan.clientBatches.length + plan.appointmentBatches.length,
    },
    dateRange,
    statusBreakdown,
    bookingSourceBreakdown,
    expectedCompletedRevenue: Number(completedRevenue.toFixed(2)),
    expectedNoShowRate:
      completedCount + noShowCount === 0
        ? 0
        : Number(((noShowCount * 100) / (completedCount + noShowCount)).toFixed(2)),
    plannedIds: {
      clients: plan.clients.map((client) => client.id),
      appointments: plan.appointments.map((appointment) => appointment.id),
      snapshots: plan.appointments.map((appointment) => appointment.snapshot_id),
    },
    batchChecksums: {
      clients: plan.clientBatchChecksums,
      appointments: plan.appointmentBatchChecksums,
    },
    execution: {
      status: "planned" as const,
      startedAt: null,
      finishedAt: null,
      completedClientBatches: [],
      completedAppointmentBatches: [],
      createdClientIds: [],
      createdAppointmentIds: [],
      createdSnapshotIds: [],
      validationStatus: "pending" as const,
      statisticsBaseline: null,
      statisticsComparison: null,
    },
  };
  const manifest: SimulationManifest = {
    ...withoutChecksum,
    checksum: checksumManifest(withoutChecksum),
  };
  const manifestPath = options.persist === false
    ? getManifestPath(manifest.runId)
    : await saveManifest(manifest);

  return { manifest, manifestPath, foundation, schema, plan, supabase };
}

async function countIds(
  supabase: SupabaseClient,
  table: "clients" | "appointments",
  salonId: string,
  ids: string[],
) {
  let count = 0;
  for (let offset = 0; offset < ids.length; offset += CLEANUP_QUERY_BATCH_SIZE) {
    const { count: batchCount, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("salon_id", salonId)
      .in("id", ids.slice(offset, offset + CLEANUP_QUERY_BATCH_SIZE));
    if (error) throw new Error(`Cleanup preview failed for ${table}: ${error.message}`);
    count += batchCount ?? 0;
  }
  return count;
}

async function countAppointmentChildren(
  supabase: SupabaseClient,
  table: "appointment_services" | "notifications",
  salonId: string,
  appointmentIds: string[],
) {
  let count = 0;
  for (
    let offset = 0;
    offset < appointmentIds.length;
    offset += CLEANUP_QUERY_BATCH_SIZE
  ) {
    const batch = appointmentIds.slice(offset, offset + CLEANUP_QUERY_BATCH_SIZE);
    const query = table === "appointment_services"
      ? supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .in("appointment_id", batch)
      : supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("salon_id", salonId)
          .eq("entity_type", "appointment")
          .in("entity_id", batch);
    const { count: batchCount, error } = await query;
    if (error) throw new Error(`Cleanup preview failed for ${table}: ${error.message}`);
    count += batchCount ?? 0;
  }
  return count;
}

export async function previewCleanup(
  environment: SimulationEnvironment,
  input: SimulationRunInput,
) {
  const identity = createRunIdentity({
    ...input,
    scenarioVersion: SIMULATION_SCENARIO_VERSION,
  });
  const runId = deterministicUuid(`run:${identity}`);
  const manifest = await readManifest(runId);
  const { checksum, ...manifestContents } = manifest;
  if (
    manifest.salon.id !== input.salonId ||
    checksum !== checksumManifest(manifestContents)
  ) {
    throw new Error("Manifest identity or checksum is invalid.");
  }

  const supabase = createSimulationSupabase(environment);
  const appointmentIds = manifest.execution.createdAppointmentIds.length
    ? manifest.execution.createdAppointmentIds
    : manifest.plannedIds.appointments;
  const clientIds = manifest.execution.createdClientIds.length
    ? manifest.execution.createdClientIds
    : manifest.plannedIds.clients;
  const [notifications, appointmentServices, appointments, clients] = await Promise.all([
    countAppointmentChildren(
      supabase,
      "notifications",
      input.salonId,
      appointmentIds,
    ),
    countAppointmentChildren(
      supabase,
      "appointment_services",
      input.salonId,
      appointmentIds,
    ),
    countIds(supabase, "appointments", input.salonId, appointmentIds),
    countIds(supabase, "clients", input.salonId, clientIds),
  ]);

  return {
    runId,
    notifications,
    appointmentServices,
    appointments,
    clients,
    message: "Cleanup preview completed; no rows were deleted.",
  };
}

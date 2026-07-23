import type { SupabaseClient } from "@supabase/supabase-js";

import {
  checksumManifest,
  readManifest,
  saveManifest,
  type SimulationManifest,
} from "../core/manifest.ts";
import type { generateSimulationPlan } from "../pipeline/generator.ts";

type SimulationPlan = Awaited<ReturnType<typeof generateSimulationPlan>>;

function assertManifestMatches(
  existing: SimulationManifest,
  generated: SimulationManifest,
) {
  const { checksum, ...contents } = existing;
  if (
    existing.runId !== generated.runId ||
    existing.salon.id !== generated.salon.id ||
    checksum !== generated.checksum ||
    checksum !== checksumManifest(contents)
  ) {
    throw new Error("Stored manifest does not match the confirmed deterministic plan.");
  }
}

async function persistExecution(
  manifest: SimulationManifest,
  updates: Partial<SimulationManifest["execution"]>,
) {
  manifest.execution = { ...manifest.execution, ...updates };
  await saveManifest(manifest);
}

export async function writeSimulationRun(input: {
  supabase: SupabaseClient;
  generatedManifest: SimulationManifest;
  plan: SimulationPlan;
  confirmation: string;
}) {
  if (input.generatedManifest.profile === "large") {
    throw new Error("Large writes remain locked until the medium profile is accepted.");
  }
  if (input.confirmation !== input.generatedManifest.runId) {
    throw new Error(`Write requires --confirm=${input.generatedManifest.runId}.`);
  }

  const manifest = await readManifest(input.generatedManifest.runId);
  assertManifestMatches(manifest, input.generatedManifest);
  manifest.mode = "seed";
  await persistExecution(manifest, {
    status: "running",
    startedAt: manifest.execution.startedAt ?? new Date().toISOString(),
    finishedAt: null,
    validationStatus: "pending",
  });

  try {
    for (let index = 0; index < input.plan.clientBatches.length; index += 1) {
      if (manifest.execution.completedClientBatches.includes(index)) continue;
      const { data, error } = await input.supabase.rpc(
        "insert_simulation_client_batch",
        {
          p_salon_id: manifest.salon.id,
          p_clients: input.plan.clientBatches[index],
        },
      );
      if (error) throw new Error(`Client batch ${index} failed: ${error.message}`);
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error(`Client batch ${index} returned an invalid result.`);
      }
      manifest.execution.completedClientBatches.push(index);
      manifest.execution.createdClientIds.push(
        ...input.plan.clientBatches[index]
          .map((client) => client.id)
          .filter((id) => !manifest.execution.createdClientIds.includes(id)),
      );
      await saveManifest(manifest);
    }

    for (let index = 0; index < input.plan.appointmentBatches.length; index += 1) {
      if (manifest.execution.completedAppointmentBatches.includes(index)) continue;
      const { data, error } = await input.supabase.rpc(
        "insert_simulation_appointment_batch",
        {
          p_salon_id: manifest.salon.id,
          p_appointments: input.plan.appointmentBatches[index],
        },
      );
      if (error) throw new Error(`Appointment batch ${index} failed: ${error.message}`);
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error(`Appointment batch ${index} returned an invalid result.`);
      }
      manifest.execution.completedAppointmentBatches.push(index);
      manifest.execution.createdAppointmentIds.push(
        ...input.plan.appointmentBatches[index]
          .map((appointment) => appointment.id)
          .filter((id) => !manifest.execution.createdAppointmentIds.includes(id)),
      );
      manifest.execution.createdSnapshotIds.push(
        ...input.plan.appointmentBatches[index]
          .map((appointment) => appointment.snapshot_id)
          .filter((id) => !manifest.execution.createdSnapshotIds.includes(id)),
      );
      await saveManifest(manifest);
    }

    await persistExecution(manifest, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });
    return manifest;
  } catch (error) {
    await persistExecution(manifest, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function cleanupSimulationRun(input: {
  supabase: SupabaseClient;
  manifest: SimulationManifest;
  confirmation: string;
}) {
  if (input.manifest.profile === "large") {
    throw new Error("Large cleanup writes remain locked until the medium profile is accepted.");
  }
  if (input.confirmation !== input.manifest.runId) {
    throw new Error(`Cleanup requires --confirm=${input.manifest.runId}.`);
  }
  if (input.manifest.mode !== "seed") {
    throw new Error("Cleanup is allowed only for a manifest that executed database writes.");
  }
  const { checksum, ...contents } = input.manifest;
  if (checksum !== checksumManifest(contents)) {
    throw new Error("Cleanup manifest checksum is invalid.");
  }

  const { data, error } = await input.supabase.rpc("cleanup_simulation_run", {
    p_salon_id: input.manifest.salon.id,
    p_appointment_ids: input.manifest.execution.createdAppointmentIds,
    p_client_ids: input.manifest.execution.createdClientIds,
  });
  if (error) throw new Error(`Cleanup failed: ${error.message}`);
  const result = Array.isArray(data) ? data[0] : null;
  if (!result) throw new Error("Cleanup returned an invalid result.");

  await persistExecution(input.manifest, {
    status: "cleaned",
    finishedAt: new Date().toISOString(),
  });
  return result as {
    deleted_notifications: number;
    deleted_snapshots: number;
    deleted_appointments: number;
    deleted_clients: number;
    retained_clients: number;
  };
}

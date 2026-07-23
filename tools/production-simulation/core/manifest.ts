import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SimulationManifest = {
  mode: "dry-run" | "seed";
  runId: string;
  scenarioVersion: number;
  seed: string;
  profile: string;
  salon: {
    id: string;
    name: string;
    timezone: string;
    currency: string;
  };
  planned: {
    clients: number;
    appointments: number;
    appointmentServices: number;
    notifications: 0;
    batches: number;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
  statusBreakdown: Record<string, number>;
  bookingSourceBreakdown: Record<string, number>;
  expectedCompletedRevenue: number;
  expectedNoShowRate: number;
  plannedIds: {
    clients: string[];
    appointments: string[];
    snapshots: string[];
  };
  batchChecksums: {
    clients: string[];
    appointments: string[];
  };
  execution: {
    status: "planned" | "running" | "completed" | "failed" | "cleaned";
    startedAt: string | null;
    finishedAt: string | null;
    completedClientBatches: number[];
    completedAppointmentBatches: number[];
    createdClientIds: string[];
    createdAppointmentIds: string[];
    createdSnapshotIds: string[];
    validationStatus: "pending" | "passed" | "failed";
    statisticsBaseline: Record<string, unknown> | null;
    statisticsComparison: Record<string, unknown> | null;
  };
  checksum: string;
};

const MANIFEST_DIRECTORY = path.resolve(process.cwd(), ".simulation");

export function getManifestPath(runId: string) {
  return path.join(MANIFEST_DIRECTORY, `${runId}.json`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function checksumManifest(value: Omit<SimulationManifest, "checksum">) {
  const deterministicPlan = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "execution" && key !== "mode"),
  );
  return createHash("sha256").update(stableJson(deterministicPlan)).digest("hex");
}

export function withManifestChecksum(
  value: Omit<SimulationManifest, "checksum">,
): SimulationManifest {
  return { ...value, checksum: checksumManifest(value) };
}

export async function saveManifest(manifest: SimulationManifest) {
  await mkdir(MANIFEST_DIRECTORY, { recursive: true });
  const target = getManifestPath(manifest.runId);
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return target;
}

export async function readManifest(runId: string) {
  const target = getManifestPath(runId);
  return JSON.parse(await readFile(target, "utf8")) as SimulationManifest;
}

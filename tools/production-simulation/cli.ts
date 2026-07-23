import {
  isSimulationProfile,
  type SimulationProfileName,
} from "./config/profiles.ts";
import { assertDateKey } from "./core/clock.ts";
import {
  checksumManifest,
  readManifest,
  saveManifest,
} from "./core/manifest.ts";
import {
  prepareDryRun,
  previewCleanup,
} from "./pipeline/runner.ts";
import { validateSimulationEnvironment } from "./validators/environmentValidator.ts";
import { validateSeededRun } from "./validators/dataValidator.ts";
import { validateStatistics } from "./validators/statisticsValidator.ts";
import {
  cleanupSimulationRun,
  writeSimulationRun,
} from "./writers/simulationWriter.ts";

type Command = "dry-run" | "seed" | "cleanup" | "validate";

function parseArguments(argv: string[]) {
  const command = argv[0] as Command | undefined;
  const values = new Map<string, string>();

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const [rawKey, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (!value || (!inlineValue && value.startsWith("--"))) {
      throw new Error(`Missing value for --${rawKey}.`);
    }
    values.set(rawKey, value);
    if (!inlineValue) index += 1;
  }

  return { command, values };
}

function required(values: Map<string, string>, key: string) {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`Missing required --${key} argument.`);
  return value;
}

function parseRunInput(values: Map<string, string>) {
  const salonId = required(values, "salon");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(salonId)) {
    throw new Error("Salon ID must be a valid UUID.");
  }
  const profileValue = required(values, "profile");
  if (!isSimulationProfile(profileValue)) throw new Error("Profile must be small, medium, or large.");

  return {
    salonId,
    profile: profileValue as SimulationProfileName,
    seed: required(values, "seed"),
    anchorDate: assertDateKey(required(values, "anchor")),
  };
}

function printPlan(result: Awaited<ReturnType<typeof prepareDryRun>>, projectRef: string) {
  const { manifest, foundation, schema, manifestPath } = result;
  console.log(JSON.stringify({
    safety: {
      projectRef,
      salonId: manifest.salon.id,
      salonName: manifest.salon.name,
      dryRun: true,
      databaseWrites: false,
      schemaReadyForWrites: schema.readyForWrites,
    },
    foundation: {
      activeAssignments: foundation.assignments.length,
      workingHours: foundation.workingHoursCount,
      closures: foundation.closuresCount,
    },
    manifest: {
      runId: manifest.runId,
      profile: manifest.profile,
      planned: manifest.planned,
      dateRange: manifest.dateRange,
      statusBreakdown: manifest.statusBreakdown,
      bookingSourceBreakdown: manifest.bookingSourceBreakdown,
      expectedCompletedRevenue: manifest.expectedCompletedRevenue,
      expectedNoShowRate: manifest.expectedNoShowRate,
      checksum: manifest.checksum,
      path: manifestPath,
    },
    schemaWarnings: schema.warnings,
  }, null, 2));
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2));
  if (!command || !["dry-run", "seed", "cleanup", "validate"].includes(command)) {
    throw new Error("Command must be dry-run, seed, cleanup, or validate.");
  }

  const environment = validateSimulationEnvironment();
  const input = parseRunInput(values);

  if (command === "cleanup") {
    const preview = await previewCleanup(environment, input);
    console.log(JSON.stringify({
      projectRef: environment.projectRef,
      salonId: input.salonId,
      ...preview,
    }, null, 2));
    const confirmation = values.get("confirm");
    if (!confirmation) return;

    const generated = await prepareDryRun(environment, input, { persist: false });
    if (!generated.schema.readyForWrites) {
      throw new Error("Schema catalog guards are not ready for cleanup writes.");
    }
    const manifest = await readManifest(generated.manifest.runId);
    const cleanup = await cleanupSimulationRun({
      supabase: generated.supabase,
      manifest,
      confirmation,
    });
    const after = await previewCleanup(environment, input);
    console.log(JSON.stringify({ cleanup, after }, null, 2));
    return;
  }

  const result = await prepareDryRun(environment, input, {
    persist: command === "dry-run",
  });
  printPlan(result, environment.projectRef);

  if (command === "seed") {
    if (!result.schema.readyForWrites) {
      throw new Error("Schema catalog guards are not ready for database writes.");
    }
    const started = performance.now();
    const beforeCounts = await Promise.all(
      (["clients", "appointments"] as const).map(async (table) => {
        const { count, error } = await result.supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("salon_id", input.salonId);
        if (error) throw new Error(`Pre-seed count failed for ${table}: ${error.message}`);
        return [table, count ?? 0] as const;
      }),
    );
    const manifest = await writeSimulationRun({
      supabase: result.supabase,
      generatedManifest: result.manifest,
      plan: result.plan,
      confirmation: values.get("confirm") ?? "",
    });
    const validation = await validateSeededRun({
      supabase: result.supabase,
      manifest,
      foundation: result.foundation,
    });
    const statistics = await validateStatistics({
      supabase: result.supabase,
      manifest,
    });
    manifest.execution.validationStatus = validation.passed && statistics.passed
      ? "passed"
      : "failed";
    manifest.execution.statisticsComparison = statistics;
    await saveManifest(manifest);
    const afterCounts = await Promise.all(
      (["clients", "appointments"] as const).map(async (table) => {
        const { count, error } = await result.supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("salon_id", input.salonId);
        if (error) throw new Error(`Post-seed count failed for ${table}: ${error.message}`);
        return [table, count ?? 0] as const;
      }),
    );
    console.log(JSON.stringify({
      durationMs: Math.round(performance.now() - started),
      before: Object.fromEntries(beforeCounts),
      after: Object.fromEntries(afterCounts),
      validation,
      statistics,
    }, null, 2));
    if (!validation.passed || !statistics.passed) {
      throw new Error("Post-seed acceptance validation failed.");
    }
    return;
  }

  if (command === "validate") {
    const manifest = await readManifest(result.manifest.runId);
    const { checksum, ...contents } = manifest;
    if (checksum !== result.manifest.checksum || checksum !== checksumManifest(contents)) {
      throw new Error("Stored manifest does not match the deterministic validation plan.");
    }
    const validation = await validateSeededRun({
      supabase: result.supabase,
      manifest,
      foundation: result.foundation,
    });
    const statistics = await validateStatistics({
      supabase: result.supabase,
      manifest,
    });
    manifest.execution.validationStatus = validation.passed && statistics.passed
      ? "passed"
      : "failed";
    manifest.execution.statisticsComparison = statistics;
    await saveManifest(manifest);
    console.log(JSON.stringify({ validation, statistics }, null, 2));
    if (!validation.passed || !statistics.passed) {
      throw new Error("Simulation validation failed.");
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown simulation error.";
  console.error(`SIMULATION_ERROR: ${message}`);
  process.exitCode = 1;
});

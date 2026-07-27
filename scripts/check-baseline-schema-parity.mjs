import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const container = process.env.BASELINE_DB_CONTAINER;
const projectRef = process.env.SUPABASE_PROJECT_REF;

if (!container || !projectRef) {
  console.error("Set BASELINE_DB_CONTAINER and SUPABASE_PROJECT_REF.");
  process.exit(1);
}

let accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  try {
    accessToken = readFileSync(resolve(homedir(), ".supabase", "access-token"), "utf8").trim();
  } catch {
    console.error("Supabase access token is not configured.");
    process.exit(1);
  }
}

const query = readFileSync(
  resolve("supabase", "baseline", "schema_contract.sql"),
  "utf8",
);

function canonicalize(contract, source) {
  const parsed = typeof contract === "string" ? JSON.parse(contract) : contract;

  // Production still contains one documented redundant subscription read policy.
  // It is intentionally absent from the canonical clean baseline and will be
  // removed by a later, production-only migration.
  if (source === "production") {
    parsed.policies = parsed.policies.filter(
      (policy) => policy.policyname !== "subscriptions_select_owner_or_manager",
    );
  }

  return parsed;
}

const localOutput = execFileSync(
  "docker",
  [
    "exec",
    "-i",
    container,
    "psql",
    "-XAt",
    "-U",
    "postgres",
    "-d",
    "postgres",
  ],
  { input: query, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
).trim();

const response = await fetch(
  `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  },
);

if (!response.ok) {
  console.error(`Production schema introspection failed with HTTP ${response.status}.`);
  process.exit(1);
}

const rows = await response.json();
const productionOutput = rows?.[0]?.jsonb_pretty;
if (typeof productionOutput !== "string") {
  console.error("Production schema introspection returned an unexpected contract.");
  process.exit(1);
}

const localContract = canonicalize(localOutput, "local");
const productionContract = canonicalize(productionOutput, "production");
const mismatchedSections = Object.keys(localContract).filter(
  (section) =>
    JSON.stringify(localContract[section]) !==
    JSON.stringify(productionContract[section]),
);

if (mismatchedSections.length > 0) {
  console.error(
    `Schema parity failed in sections: ${mismatchedSections.join(", ")}. No schema content was printed.`,
  );
  for (const section of mismatchedSections) {
    console.error(
      `${section}: local=${localContract[section].length}, production=${productionContract[section]?.length ?? 0}`,
    );
    if (section === "grants" && process.env.BASELINE_PARITY_DETAILS === "true") {
      const local = new Set(localContract.grants.map((grant) => JSON.stringify(grant)));
      const production = new Set(productionContract.grants.map((grant) => JSON.stringify(grant)));
      console.error("Grant entries only in local:", [...local].filter((entry) => !production.has(entry)));
      console.error("Grant entries only in production:", [...production].filter((entry) => !local.has(entry)));
    }
  }
  process.exit(1);
}

console.log("Schema parity passed for enums, columns, constraints, indexes, functions, triggers, RLS, policies and grants.");

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const image = "public.ecr.aws/supabase/postgres:17.6.1.121";
const container = `rezervo-checkout-intent-contract-${process.pid}-${Date.now()}`;
const database = "postgres";
const cutover = readFileSync("supabase/baseline/cutover.txt", "utf8").trim();

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`Docker command failed (${result.status}): ${(result.stderr ?? "").trim()}`);
  }
}

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
}

function applySqlFile(path, label) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`[${label}] ${stderr.trim()}`)));
    createReadStream(path).on("error", reject).pipe(child.stdin);
  });
}

async function initializeDatabase() {
  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", image]);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", database], { stdio: "ignore" });
    if (ready.status === 0) break;
    if (attempt === 89) throw new Error("Disposable PostgreSQL did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await applySqlFile("supabase/baseline/schema.sql", "baseline schema");
  await applySqlFile("supabase/baseline/reference_seed.sql", "reference seed");
  const migrations = readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql") && basename(name, ".sql") > cutover)
    .sort();
  for (const migration of migrations) {
    await applySqlFile(join("supabase/migrations", migration), migration);
  }
}

let initialized = false;
try {
  await initializeDatabase();
  initialized = true;
  await applySqlFile("supabase/tests/billing_checkout_active_intent_contract.sql", "active checkout intent contract");
  console.log("Billing checkout active intent SQL contract passed on disposable PostgreSQL.");
} finally {
  if (initialized || spawnSync("docker", ["inspect", container], { stdio: "ignore" }).status === 0) {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  }
}

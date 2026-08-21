import { spawn, spawnSync } from "node:child_process";
import { createReadStream, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const image = "public.ecr.aws/supabase/postgres:17.6.1.121";
const database = "postgres";

export function createDisposableSupabasePostgres(prefix) {
  const container = `${prefix}-${process.pid}-${Date.now()}`;

  function docker(args, options = {}) {
    const result = spawnSync("docker", args, { encoding: "utf8", ...options });
    if (result.status !== 0) {
      throw new Error(`Docker command failed (${result.status}): ${(result.stderr ?? "").trim()}`);
    }
    return (result.stdout ?? "").trim();
  }

  function psqlArgs({ tuplesOnly = false } = {}) {
    return ["exec", "-i", container, "psql", tuplesOnly ? "-XAt" : "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
  }

  function applySqlFile(path, label) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`[${label}] ${stderr.trim()}`)));
      createReadStream(path).on("error", reject).pipe(child.stdin);
    });
  }

  function sqlSession(sqlText, label) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", psqlArgs({ tuplesOnly: true }), { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0
        ? resolve(stdout.trim())
        : reject(new Error(`[${label}] SQL failed (${code}): ${stderr.trim()}`)));
      child.stdin.end(sqlText);
    });
  }

  async function initialize() {
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
    const cutover = readFileSync("supabase/baseline/cutover.txt", "utf8").trim();
    const migrations = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql") && basename(name, ".sql") > cutover)
      .sort();
    for (const migration of migrations) {
      await applySqlFile(join("supabase/migrations", migration), migration);
    }
  }

  function cleanup() {
    if (spawnSync("docker", ["inspect", container], { stdio: "ignore" }).status === 0) {
      spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    }
  }

  return { container, initialize, applySqlFile, sql: sqlSession, sqlSession, cleanup };
}

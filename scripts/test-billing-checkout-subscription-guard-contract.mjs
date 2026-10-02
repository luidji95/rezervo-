import { spawn, spawnSync } from "node:child_process";
import { createReadStream, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const image = "public.ecr.aws/supabase/postgres:17.6.1.121";
const container = `rezervo-checkout-subscription-guard-${process.pid}-${Date.now()}`;
const cutover = readFileSync("supabase/baseline/cutover.txt", "utf8").trim();

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`Docker command failed (${result.status}): ${(result.stderr ?? "").trim()}`);
}
function psqlArgs() { return ["exec","-i",container,"psql","-X","-q","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"]; }
function apply(path, label) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe","inherit","pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`[${label}] ${stderr.trim()}`)));
    createReadStream(path).on("error", reject).pipe(child.stdin);
  });
}

let exists = false;
try {
  docker(["run","-d","--name",container,"-e","POSTGRES_PASSWORD=postgres","-e","POSTGRES_DB=postgres",image]);
  exists = true;
  for (let attempt=0; attempt<90; attempt+=1) {
    if (spawnSync("docker",["exec",container,"pg_isready","-U","postgres","-d","postgres"],{stdio:"ignore"}).status===0) break;
    if (attempt===89) throw new Error("Disposable PostgreSQL did not become ready");
    await new Promise((resolve) => setTimeout(resolve,1000));
  }
  await new Promise((resolve) => setTimeout(resolve,5000));
  await apply("supabase/baseline/schema.sql","baseline schema");
  await apply("supabase/baseline/reference_seed.sql","reference seed");
  for (const migration of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql") && basename(name,".sql")>cutover).sort()) {
    await apply(join("supabase/migrations",migration),migration);
  }
  await apply("supabase/tests/billing_checkout_subscription_guard_contract.sql","B10 subscription guard contract");
  console.log("B10 subscription-aware checkout SQL contract passed on disposable PostgreSQL (16 guarded/allowed contract scenarios).");
} finally {
  if (exists) spawnSync("docker",["rm","-f",container],{stdio:"ignore"});
}

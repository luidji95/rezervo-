import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";

const container = process.env.BILLING_RETRY_DB_CONTAINER ?? "supabase_db_rezervo";
const database = process.env.BILLING_RETRY_DB ?? "postgres";
const contracts = [
  "supabase/tests/billing_webhook_retry_worker_contract.sql",
  "supabase/tests/billing_webhook_retry_worker_environment_contract.sql",
];

function runContract(path) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", database,
    ], { stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Retry worker SQL contract failed (${path}, exit ${code})`));
    });
    createReadStream(path).on("error", reject).pipe(child.stdin);
  });
}

for (const contract of contracts) {
  console.log(`Running ${contract}`);
  await runContract(contract);
}

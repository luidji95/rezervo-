import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";

const container = process.env.BILLING_CHECKOUT_RECOVERY_DB_CONTAINER ?? "supabase_db_rezervo";
const database = process.env.BILLING_CHECKOUT_RECOVERY_DB ?? "postgres";
const contract = "supabase/tests/billing_checkout_recovery_claim_contract.sql";

const child = spawn("docker", [
  "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
  "-U", "postgres", "-d", database,
], { stdio: ["pipe", "inherit", "inherit"] });

const completion = new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code) => code === 0
    ? resolve()
    : reject(new Error(`Checkout recovery SQL contract failed (exit ${code})`)));
});

createReadStream(contract).on("error", (error) => {
  child.stdin.destroy(error);
}).pipe(child.stdin);

await completion;
console.log("Billing checkout recovery SQL contract passed.");

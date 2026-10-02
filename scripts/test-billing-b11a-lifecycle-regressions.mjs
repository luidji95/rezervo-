import { spawnSync } from "node:child_process";

import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-b11a-lifecycle");
const contracts = [
  "supabase/tests/billing_environment_aware_subscription_processors_contract.sql",
];

function runConcurrency(script, environment) {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed (${result.status}): ${(result.stderr ?? "").trim()}`);
  }
  if (result.stdout) process.stdout.write(result.stdout);
}

try {
  await postgres.initialize();
  for (const contract of contracts) await postgres.applySqlFile(contract, contract);
  runConcurrency("scripts/test-billing-subscription-created-concurrency.mjs", {
    CREATED_PROCESSOR_DB_CONTAINER: postgres.container,
    BILLING_PROCESSOR_TEST_DATABASE: "postgres",
  });
  runConcurrency("scripts/test-billing-subscription-updated-concurrency.mjs", {
    UPDATED_PROCESSOR_DB_CONTAINER: postgres.container,
    UPDATED_PROCESSOR_DB: "postgres",
  });
  console.log("B11a created/updated/environment-aware lifecycle regressions passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

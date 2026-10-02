import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-billing-sandbox-contract");

try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_sandbox_foundation_contract.sql",
    "billing sandbox foundation contract",
  );
  console.log("Billing sandbox foundation contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

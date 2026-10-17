import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-d-operator-recovery");

try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_operator_recovery_contract.sql",
    "billing operator recovery contract",
  );
  console.log("Billing operator recovery contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

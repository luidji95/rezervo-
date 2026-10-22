import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// C2 operator recovery contract on a disposable PostgreSQL container only.
const postgres = createDisposableSupabasePostgres("rezervo-c2-operator-recovery");

try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_c2_operator_recovery_contract.sql",
    "billing C2 operator recovery contract",
  );
  console.log("Billing C2 operator recovery contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

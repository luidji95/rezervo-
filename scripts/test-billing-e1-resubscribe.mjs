import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// E1 resubscribe contract on a disposable PostgreSQL container only (never the persistent local database).
const postgres = createDisposableSupabasePostgres("rezervo-e1-resubscribe");

try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_e1_resubscribe_contract.sql",
    "billing E1 resubscribe contract",
  );
  console.log("Billing E1 resubscribe contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

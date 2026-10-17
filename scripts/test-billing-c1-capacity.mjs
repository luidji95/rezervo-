import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-c1-capacity");

try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_c1_trial_purchase_capacity_contract.sql",
    "billing C1 trial purchase capacity contract",
  );
  console.log("Billing C1 trial purchase capacity contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

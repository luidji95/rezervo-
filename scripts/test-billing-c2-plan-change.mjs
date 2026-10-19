import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// C2 next-renewal plan change contract on a disposable PostgreSQL container only.
const postgres = createDisposableSupabasePostgres("rezervo-c2-plan-change");

try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_c2_plan_change_contract.sql",
    "billing C2 plan change contract",
  );
  console.log("Billing C2 plan change contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

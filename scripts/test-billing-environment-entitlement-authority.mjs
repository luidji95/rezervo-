import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-b9a-entitlement-authority");

try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_environment_entitlement_authority_contract.sql",
    "billing environment entitlement authority contract",
  );
  console.log("Billing environment entitlement authority contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

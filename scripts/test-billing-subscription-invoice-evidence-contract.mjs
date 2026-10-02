import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-b11a-invoice-evidence");
try {
  await postgres.initialize();
  await postgres.applySqlFile(
    "supabase/tests/billing_subscription_invoice_evidence_contract.sql",
    "billing subscription invoice evidence contract",
  );
  console.log("B11a invoice evidence SQL contract passed on disposable PostgreSQL (atomicity, idempotency, isolation, grants and no-mutation). ");
} finally {
  postgres.cleanup();
}

import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-checkout-recovery-contract");
const contracts = [
  "supabase/tests/billing_checkout_recovery_claim_contract.sql",
  "supabase/tests/billing_checkout_recovery_finalization_contract.sql",
];

try {
  await postgres.initialize();
  for (const contract of contracts) await postgres.applySqlFile(contract, contract);
  console.log("Billing checkout recovery SQL contract passed on disposable PostgreSQL (2 contracts).");
} finally {
  postgres.cleanup();
}

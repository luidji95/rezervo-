import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-b9a-entitlement-gateways");
const contracts = [
  "supabase/tests/public_booking_subscription_access.sql",
  "supabase/tests/employee_capacity_contract.sql",
  "supabase/tests/appointment_mutation_contract.sql",
  "supabase/tests/business_data_mutation_contract.sql",
  "supabase/tests/reminder_canonical_entitlement_contract.sql",
];

try {
  await postgres.initialize();
  await postgres.sqlSession(
    "insert into private.billing_runtime_config(singleton,environment) values(true,'test');",
    "test project billing environment bootstrap",
  );
  for (const contract of contracts) {
    await postgres.applySqlFile(contract, contract);
  }
  console.log(`B9a entitlement gateway contracts passed on disposable PostgreSQL (${contracts.length} contracts).`);
} finally {
  postgres.cleanup();
}

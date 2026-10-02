import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// The old runner assumed an externally supplied PRE-029 database. On an already
// migrated database its malformed fixture was rejected before 029 could run.
// Own a disposable full-chain database; simulate the pre-029 constraint state
// only in a rolled-back transaction. Never target BASELINE_DB_CONTAINER.
const postgres = createDisposableSupabasePostgres("rezervo-provider-period-preflight");
const migration = readFileSync("supabase/migrations/202607290029_harden_provider_active_subscription_period.sql", "utf8")
  .replace(/^begin;\s*/, "").replace(/commit;\s*$/, "");
assert.equal(migration.split("provider_customer_id ~ '[^[:space:]]'").length - 1, 2);
assert.equal(migration.split("provider_subscription_id ~ '[^[:space:]]'").length - 1, 2);
const owner = "aa100000-0000-4000-8000-000000000001";
const salon = "aa200000-0000-4000-8000-000000000001";
const fixture = `
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','provider-period-preflight@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values('${salon}','${owner}','Provider Period Preflight','provider-period-preflight');
  update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,
    billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id='   ',provider_subscription_id='preflight-subscription',
    current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
    provider_state_updated_at='2026-07-01T00:01:00Z' where salon_id='${salon}';
`;
try {
  await postgres.initialize();
  await postgres.applySqlFile("supabase/baseline/local_platform_grant_normalization.sql", "local ACL normalization");
  await assert.rejects(postgres.sql(`begin; ${fixture}`, "old fixture on full chain"), /subscriptions_provider_active_period_consistent/);
  await assert.rejects(postgres.sql(`begin;
    alter table public.subscriptions drop constraint subscriptions_provider_active_period_consistent;
    ${fixture}
    ${migration}`, "029 preflight rejects malformed history"),
  /BILLING_PROVIDER_ACTIVE_PERIOD_CONTRACT_VIOLATION invalid_row_count=1/);
  assert.equal(await postgres.sql(`select
    (select count(*) from public.salons where id='${salon}')||'|'||
    (select count(*) from pg_constraint where conrelid='public.subscriptions'::regclass and conname='subscriptions_provider_active_period_consistent' and convalidated);`, "rollback evidence"), "0|1");
  // Effective 038 owns access, not the historical 029 legacy-access expectations.
  await postgres.applySqlFile("supabase/tests/billing_environment_entitlement_authority_contract.sql", "effective environment authority");
  console.log("029 runner passed: full-chain fixture rejection reproduced, preflight failure rolled back, effective 038 authority passed; disposable DB only.");
} finally {
  postgres.cleanup();
}

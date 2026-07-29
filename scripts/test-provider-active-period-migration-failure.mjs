import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = process.env.BASELINE_DB_CONTAINER ?? "supabase_db_rezervo";
const ownerId = "aa100000-0000-4000-8000-000000000001";
const salonId = "aa200000-0000-4000-8000-000000000001";
const migration = readFileSync(
  "supabase/migrations/202607290029_harden_provider_active_subscription_period.sql",
  "utf8",
);
const customerNonBlank = "provider_customer_id ~ '[^[:space:]]'";
const subscriptionNonBlank = "provider_subscription_id ~ '[^[:space:]]'";
if (migration.split(customerNonBlank).length - 1 !== 2
  || migration.split(subscriptionNonBlank).length - 1 !== 2) {
  throw new Error("Migration preflight and CHECK do not share the provider-ID non-blank contract.");
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atc", sql],
    { encoding: "utf8" },
  ).trim();
}

try {
  psql(`
    delete from public.salons where id='${salonId}';
    delete from auth.users where id='${ownerId}';
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values('${ownerId}','provider-period-preflight@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
      values('${salonId}','${ownerId}','Provider Period Preflight','provider-period-preflight');
    update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,
      billing_provider='lemonsqueezy',billing_environment='test',
      provider_customer_id='   ',provider_subscription_id='preflight-subscription',
      current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-08-01T00:00:00Z',
      provider_state_updated_at='2026-07-01T00:01:00Z'
    where salon_id='${salonId}';
  `);

  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    { encoding: "utf8", input: migration },
  );
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0
    || !diagnostic.includes("BILLING_PROVIDER_ACTIVE_PERIOD_CONTRACT_VIOLATION invalid_row_count=1")) {
    throw new Error("Provider-active period migration did not fail with the stable preflight contract.");
  }

  const evidence = psql(`select concat_ws('|',
    status='active',billing_provider='lemonsqueezy',length(provider_customer_id)=3,
    current_period_ends_at>current_period_starts_at,
    (select count(*) from pg_catalog.pg_constraint where conrelid='public.subscriptions'::regclass
      and conname='subscriptions_provider_active_period_consistent'))
    from public.subscriptions where salon_id='${salonId}'`);
  if (evidence !== "t|t|t|t|0") {
    throw new Error("Failed migration changed the malformed fixture or left a partial constraint.");
  }

  console.log("Provider-active period preflight rollback passed.");
} finally {
  psql(`delete from public.salons where id='${salonId}'; delete from auth.users where id='${ownerId}';`);
}

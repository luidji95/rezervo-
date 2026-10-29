import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Internal trial length (migration 202610280050) on a disposable PostgreSQL container only — never the
// persistent local database or a remote project. The schema is built up to 049, pre-existing rows are
// created with the old 14-day trigger, then 050 is applied and the contract runs.
const TARGET = "202610280050";
const postgres = createDisposableSupabasePostgres("rezervo-internal-trial");

try {
  // Same image and baseline as initialize(), but stop before the migration under test.
  const run = spawnSync("docker", ["run", "-d", "--network", "none", "--name", postgres.container,
    "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", "public.ecr.aws/supabase/postgres:17.6.1.121"], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (spawnSync("docker", ["exec", postgres.container, "pg_isready", "-U", "postgres"], { stdio: "ignore" }).status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await postgres.applySqlFile("supabase/baseline/schema.sql", "baseline schema");
  await postgres.applySqlFile("supabase/baseline/reference_seed.sql", "reference seed");
  const cutover = readFileSync("supabase/baseline/cutover.txt", "utf8").trim();
  const migrations = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql") && basename(n, ".sql") > cutover).sort();
  if (!migrations.some((n) => n.startsWith(TARGET))) throw new Error("migration under test not found");
  for (const m of migrations.filter((n) => n.split("_")[0] < TARGET)) await postgres.applySqlFile(`supabase/migrations/${m}`, m);

  // Pre-existing rows with the old behaviour: a 14-day trial, a paid subscription and a pilot override.
  await postgres.sql(`
    create table public.pre_050_fixture(label text primary key, salon_id uuid not null, subscription_md5 text, override_md5 text);
    do $$ declare o uuid; s uuid; begin
      foreach o in array array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()] loop
        insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(o, o||'@example.invalid','{}','{}');
        insert into public.salons(id,owner_id,name,slug) values(gen_random_uuid(), o, 'pre '||o, 'pre-'||substr(o::text,1,8)) returning id into s;
        insert into public.pre_050_fixture(label, salon_id) values(
          case (select count(*) from public.pre_050_fixture) when 0 then 'old_trial' when 1 then 'paid' else 'override' end, s);
      end loop;
    end $$;
    update public.subscriptions set status='active', billing_provider='lemonsqueezy', billing_environment='test',
      provider_customer_id='9001', provider_subscription_id='9002', current_period_starts_at=now(),
      current_period_ends_at=now()+interval '1 month', provider_state_updated_at=now()
    where salon_id=(select salon_id from public.pre_050_fixture where label='paid');
    insert into public.billing_access_overrides(salon_id, plan_id, override_type, reason, starts_at, ends_at)
    select salon_id, (select id from public.plans where slug='pro'), 'pilot', 'pre-050 fixture', now()-interval '1 day', now()+interval '30 days'
    from public.pre_050_fixture where label='override';
    update public.pre_050_fixture f set
      subscription_md5 = (select md5(row(s.plan_id, s.status, s.trial_starts_at, s.trial_ends_at, s.current_period_starts_at,
        s.current_period_ends_at, s.billing_provider, s.billing_environment, s.provider_customer_id,
        s.provider_subscription_id, s.cancel_at_period_end, s.cancelled_at, s.provider_state_updated_at)::text)
        from public.subscriptions s where s.salon_id = f.salon_id),
      override_md5 = (select coalesce(md5(string_agg(row(o.plan_id, o.enabled, o.starts_at, o.ends_at, o.override_type)::text, ',' order by o.id)), '-')
        from public.billing_access_overrides o where o.salon_id = f.salon_id);
    select count(*) from public.pre_050_fixture;`, "pre-050 fixture");

  for (const m of migrations.filter((n) => n.split("_")[0] >= TARGET)) await postgres.applySqlFile(`supabase/migrations/${m}`, m);
  await postgres.applySqlFile("supabase/tests/internal_trial_length_contract.sql", "internal trial length contract");
  console.log("Internal 3-month trial contract passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

// End-to-end check of the operator recovery TypeScript layer against the real RPCs on a
// disposable PostgreSQL container. The provider is a local fake; no remote service is contacted.
//   node --experimental-strip-types scripts/test-billing-operator-recovery-cli-db.mjs
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";
import { parseRecoveryArgs } from "../src/features/billing/recovery/billingRecoveryArgs.ts";
import { formatRecoveryReport, runBillingRecovery } from "../src/features/billing/recovery/billingRecoveryCore.ts";
import { SupabaseBillingRecoveryRepository } from "../src/features/billing/recovery/supabaseBillingRecoveryRepository.ts";

const postgres = createDisposableSupabasePostgres("rezervo-d-operator-recovery-cli");
const assert = (condition, message) => { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); };
const literal = (value) => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
};

// A service-role-like client whose rpc()/from() calls are executed as SQL on the disposable database.
const client = {
  async rpc(name, args) {
    try {
      const named = Object.entries(args).map(([key, value]) => `${key} => ${literal(value)}`).join(", ");
      const out = await postgres.sql(`select row_to_json(r) from public.${name}(${named}) r;`, name);
      return { data: out ? JSON.parse(out) : null, error: null };
    } catch (error) { return { data: null, error }; }
  },
  from() {
    const filters = [];
    const chain = {
      select() { return chain; },
      eq(column, value) { filters.push(`${column} = ${literal(value)}`); return chain; },
      async maybeSingle() {
        try {
          const out = await postgres.sql(`select row_to_json(s) from (select provider_subscription_id from public.subscriptions where ${filters.join(" and ")}) s;`, "lookup");
          return { data: out ? JSON.parse(out) : null, error: null };
        } catch (error) { return { data: null, error }; }
      },
    };
    return chain;
  },
};

const ID = (suffix) => `11111111-1111-4111-8111-1111111111${suffix}`;
let providerSnapshot = null;
const provider = { async retrieveSubscription() { return { snapshot: providerSnapshot, rateLimitRemaining: 10 }; } };
const repository = new SupabaseBillingRecoveryRepository(client);
const run = (argv) => runBillingRecovery({ command: parseRecoveryArgs(argv), environment: "test", storeId: "store-test-v2", repository, provider });
const APPLY = (token) => ["--apply", "--review-token", token, "--ticket", "OPS-CLI-1", "--reason", "cli end to end check", "--operator", "cli-test@example.invalid"];

try {
  await postgres.initialize();
  await postgres.sql(`
    insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
      provider_product_id,provider_variant_id,provider_store_id,is_active)
    select id,'lemonsqueezy','test','monthly',currency,monthly_price,'product-test-v2','variant-test-v2','store-test-v2',true
    from public.plans where slug='starter'
    on conflict(provider,environment,plan_id,billing_interval,currency) do update set is_active=true;
    insert into private.billing_runtime_config(singleton,environment) values(true,'test')
    on conflict(singleton) do update set environment='test';
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values('${ID("c1")}','cli@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values('${ID("c2")}','${ID("c1")}','cli','cli');
    update public.subscriptions set plan_id=(select id from public.plans where slug='starter'),status='past_due',
      billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='cust-1',provider_subscription_id='900',
      current_period_starts_at='2026-07-01T00:00:00Z',current_period_ends_at='2026-09-01T00:00:00Z',
      provider_state_updated_at='2026-08-05T00:00:00Z' where salon_id='${ID("c2")}';`, "setup");
  const subId = (await postgres.sql(`select id from public.subscriptions where salon_id='${ID("c2")}';`, "sub id")).trim();

  // snapshot path: dry-run then apply through the TypeScript layer
  providerSnapshot = {
    providerSubscriptionId: "900", providerStoreId: "store-test-v2", providerCustomerId: "cust-1", providerOrderId: "1",
    providerProductId: "product-test-v2", providerVariantId: "variant-test-v2", providerStatus: "active", providerCancelled: false,
    providerPauseMode: null, providerPauseResumesAt: null, providerTrialEndsAt: null,
    providerRenewsAt: "2099-01-01T00:00:00Z", providerEndsAt: null,
    providerCreatedAt: "2026-07-01T00:00:00Z", providerUpdatedAt: "2026-08-10T00:00:00Z", testMode: true,
  };
  const dry = await run(["subscription", "--subscription", subId]);
  assert(dry.status === "eligible" && dry.exitCode === 0 && /^[0-9a-f]{64}$/.test(dry.reviewToken ?? ""), `dry-run ${JSON.stringify(dry)}`);
  assert(/Proposed/.test(formatRecoveryReport(dry)) && !/cust-1/.test(formatRecoveryReport(dry)), "dry-run output");
  assert((await postgres.sql(`select status from public.subscriptions where id='${subId}';`, "after dry")).trim() === "past_due", "dry-run mutated");
  const applied = await run(["subscription", "--subscription", subId, ...APPLY(dry.reviewToken)]);
  assert(applied.status === "applied" && applied.exitCode === 0, `apply ${JSON.stringify(applied)}`);
  assert((await postgres.sql(`select status from public.subscriptions where id='${subId}';`, "after apply")).trim() === "active", "apply did not change status");
  const repeat = await run(["subscription", "--subscription", subId, ...APPLY(dry.reviewToken)]);
  assert(repeat.status === "no_change" && repeat.exitCode === 0, `repeat ${JSON.stringify(repeat)}`);
  const stale = await run(["subscription", "--subscription", subId, ...APPLY("f".repeat(64))]);
  assert(stale.status === "no_change", "no_change must not depend on the token once state matches");

  // event path: allowlisted manual_review event reprocessed through the existing processor
  await postgres.sql(`update public.subscriptions set status='active',provider_state_updated_at='2026-08-01T00:00:00Z',
    current_period_ends_at='2026-09-01T00:00:00Z' where id='${subId}';`, "reset");
  const eventId = (await postgres.sql(`select event_id from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_updated','subscriptions','900',
    encode(digest('cli-event','sha256'),'hex'),encode(digest('cli-semantic','sha256'),'hex'),
    'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    '900','o1','cust-1','product-test-v2','variant-test-v2','past_due','2026-07-01T00:00:00Z','2026-08-06T00:00:00Z',
    true,'ready',null,'store-test-v2',null,null,false,null,null,null);
    `, "event")).trim();
  await postgres.sql(`update public.billing_webhook_events set processing_status='manual_review',
    error_code='processor_retry_exhausted',processed_at=now() where id='${eventId}';`, "park");
  const eventDry = await run(["event", "--event", eventId]);
  assert(eventDry.status === "eligible" && eventDry.details["Prior reason"] === "processor_retry_exhausted", `event dry-run ${JSON.stringify(eventDry)}`);
  const eventApplied = await run(["event", "--event", eventId, ...APPLY(eventDry.reviewToken)]);
  assert(eventApplied.status === "reprocessed", `event apply ${JSON.stringify(eventApplied)}`);
  const audit = await postgres.sql(`select count(*) from public.billing_recovery_attempts where outcome in ('applied','reprocessed','no_change');`, "audit");
  assert(Number(audit) >= 3, `audit rows ${audit}`);
  const rejected = await run(["event", "--event", ID("ee")]);
  assert(rejected.status === "not_found" && rejected.exitCode === 2, `unknown event ${JSON.stringify(rejected)}`);

  console.log("Billing operator recovery CLI layer passed against disposable PostgreSQL RPCs.");
} finally {
  postgres.cleanup();
}

import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Concurrency checks for operator billing recovery. Runs only on a disposable PostgreSQL container
// created by the shared helper; the persistent local Supabase database is never used.
const postgres = createDisposableSupabasePostgres("rezervo-d-operator-recovery-concurrency");
const NOW = "2026-08-11T00:00:00Z";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); };
const subOf = async (suffix) => (await postgres.sql(`select id from public.subscriptions where salon_id='11111111-1111-4111-8111-1111111111${suffix}';`, `subscription ${suffix}`)).trim();
const rows = (text) => text.split("\n").filter(Boolean).map((line) => JSON.parse(line));

const link = (label, uuidSuffix) => `
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values('00000000-0000-4000-8000-0000000000${uuidSuffix}','${label}@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values('11111111-1111-4111-8111-1111111111${uuidSuffix}','00000000-0000-4000-8000-0000000000${uuidSuffix}','${label}','${label}');
  update public.subscriptions set plan_id=(select id from public.plans where slug='starter'),status='active',
    billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='customer-${label}',
    provider_subscription_id='sub-${label}',current_period_starts_at='2026-07-01T00:00:00Z',
    current_period_ends_at='2026-09-01T00:00:00Z',provider_state_updated_at='2026-07-01T00:01:00Z'
  where salon_id='11111111-1111-4111-8111-1111111111${uuidSuffix}';`;

const ingest = (label, suffix, status, updated, renews, cancelled) => `
  select event_id from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_updated','subscriptions','sub-${label}',
    encode(digest('event-${label}-${suffix}','sha256'),'hex'),encode(digest('semantic-${label}-${suffix}','sha256'),'hex'),
    'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    'sub-${label}','order-${suffix}','customer-${label}','product-test-v2','variant-test-v2','${status}',
    '2026-07-01T00:00:00Z','${updated}',true,'ready',null,'store-test-v2',${renews ? `'${renews}'` : "null"},null,${cancelled},null,null,null);`;

const snapArgs = (label, id, status, updated, renews) =>
  `'test','${id}','sub-${label}','customer-${label}','store-test-v2',true,'product-test-v2','variant-test-v2',` +
  `'${status}',false,null,null,null,${renews ? `'${renews}'` : "null"},null,'2026-07-01T00:00:00Z','${updated}'`;

try {
  await postgres.initialize();
  await postgres.sql(`
    insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
      provider_product_id,provider_variant_id,provider_store_id,is_active)
    select id,'lemonsqueezy','test','monthly',currency,monthly_price,'product-test-v2','variant-test-v2','store-test-v2',true
    from public.plans where slug='starter'
    on conflict(provider,environment,plan_id,billing_interval,currency) do update set
      provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
      provider_store_id=excluded.provider_store_id,is_active=true;
    insert into private.billing_runtime_config(singleton,environment) values(true,'test')
    on conflict(singleton) do update set environment='test';
  `, "catalogue");

  // ---- 1. two operators reprocess the same manual_review event concurrently
  const event1 = (await postgres.sql(`${link("opevent", "a1")}
    ${ingest("opevent", "one", "past_due", "2026-08-05T00:00:00Z", null, false)}`, "setup 1")).split("\n").pop();
  const sub1 = await subOf("a1");
  await postgres.sql(`update public.billing_webhook_events set processing_status='manual_review',
    error_code='processor_retry_exhausted',processed_at='${NOW}' where id='${event1}';`, "park 1");
  const plan1 = (await postgres.sql(`select token from (select review_token token from public.plan_billing_event_reprocess_v1('test','${event1}','${NOW}')) q;`, "plan 1")).trim();
  const apply = (label) => `select row_to_json(r) from public.apply_billing_event_reprocess_v1('test','${event1}','${plan1}','OPS-C1','concurrent reprocess ${label}','op-${label}','${NOW}') r;`;
  const first = postgres.sql(`begin; ${apply("a")} select pg_sleep(1.5); commit;`, "operator a");
  await sleep(400);
  const second = postgres.sql(apply("b"), "operator b");
  const [ra, rb] = (await Promise.all([first, second])).map((out) => rows(out)[0]);
  const outcomes = [ra.outcome, rb.outcome].sort();
  assert(outcomes[0] === "no_change" && outcomes[1] === "reprocessed", `parallel operators produced ${outcomes}`);
  const check1 = await postgres.sql(`select json_build_object(
    'processed', (select count(*) from public.billing_webhook_events where id='${event1}' and processing_status='processed'),
    'attempts', (select processing_attempt_count from public.billing_webhook_events where id='${event1}'),
    'audit', (select count(*) from public.billing_recovery_attempts where webhook_event_id='${event1}'),
    'status', (select status from public.subscriptions where id='${sub1}'));`, "check 1");
  const c1 = JSON.parse(check1);
  assert(c1.processed === 1 && c1.attempts === 1 && c1.audit === 2 && c1.status === "past_due", `reprocess effects ${check1}`);

  // ---- 2. two operators apply the same reviewed snapshot concurrently
  await postgres.sql(link("opsnap", "a2"), "setup 2");
  const sub2 = await subOf("a2");
  const token2 = (await postgres.sql(`select review_token from public.plan_billing_subscription_recovery_v1(
    ${snapArgs("opsnap", sub2, "active", "2026-08-10T00:00:00Z", "2026-09-10T00:00:00Z")},'${NOW}');`, "plan 2")).trim();
  const apply2 = (label) => `select row_to_json(r) from public.apply_billing_subscription_recovery_v1(
    ${snapArgs("opsnap", sub2, "active", "2026-08-10T00:00:00Z", "2026-09-10T00:00:00Z")},
    '${token2}','OPS-C2','concurrent snapshot ${label}','op-${label}','${NOW}') r;`;
  const f2 = postgres.sql(`begin; ${apply2("a")} select pg_sleep(1.5); commit;`, "snap a");
  await sleep(400);
  const s2 = postgres.sql(apply2("b"), "snap b");
  const o2 = (await Promise.all([f2, s2])).map((out) => rows(out)[0].outcome).sort();
  assert(o2[0] === "applied" && o2[1] === "no_change", `parallel snapshot applies produced ${o2}`);

  // ---- 3. operator apply vs a concurrent newer webhook: newer provider state always wins
  await postgres.sql(link("opwebhook", "a3"), "setup 3");
  const sub3 = await subOf("a3");
  const hook = (await postgres.sql(ingest("opwebhook", "new", "past_due", "2026-08-20T00:00:00Z", null, false), "ingest 3")).trim();
  const token3 = (await postgres.sql(`select review_token from public.plan_billing_subscription_recovery_v1(
    ${snapArgs("opwebhook", sub3, "active", "2026-08-10T00:00:00Z", "2026-09-10T00:00:00Z")},'${NOW}');`, "plan 3")).trim();
  const operator3 = postgres.sql(`begin; select row_to_json(r) from public.apply_billing_subscription_recovery_v1(
    ${snapArgs("opwebhook", sub3, "active", "2026-08-10T00:00:00Z", "2026-09-10T00:00:00Z")},
    '${token3}','OPS-C3','operator versus webhook','op-a','${NOW}') r; select pg_sleep(1.5); commit;`, "operator 3");
  await sleep(400);
  const webhook3 = postgres.sql(`select outcome from public.process_billing_subscription_updated_v2('${hook}','2026-08-21T00:00:00Z');`, "webhook 3");
  const [op3, wh3] = await Promise.all([operator3, webhook3]);
  assert(rows(op3)[0].outcome === "applied" && wh3.trim() === "processed", `operator/webhook outcomes ${op3} ${wh3}`);
  const state3 = await postgres.sql(`select status||'|'||provider_state_updated_at::text from public.subscriptions where id='${sub3}';`, "state 3");
  assert(state3.startsWith("past_due|2026-08-20"), `newer webhook state must win, got ${state3}`);

  // ---- 3b. webhook holds the lock first; the operator's reviewed snapshot is then rejected as stale/older
  await postgres.sql(link("opwebhook2", "a4"), "setup 3b");
  const sub4 = await subOf("a4");
  const hook4 = (await postgres.sql(ingest("opwebhook2", "new", "past_due", "2026-08-20T00:00:00Z", null, false), "ingest 3b")).trim();
  const token4 = (await postgres.sql(`select review_token from public.plan_billing_subscription_recovery_v1(
    ${snapArgs("opwebhook2", sub4, "active", "2026-08-10T00:00:00Z", "2026-09-10T00:00:00Z")},'${NOW}');`, "plan 3b")).trim();
  const webhook4 = postgres.sql(`begin; select outcome from public.process_billing_subscription_updated_v2('${hook4}','2026-08-21T00:00:00Z'); select pg_sleep(1.5); commit;`, "webhook 3b");
  await sleep(400);
  const operator4 = postgres.sql(`select row_to_json(r) from public.apply_billing_subscription_recovery_v1(
    ${snapArgs("opwebhook2", sub4, "active", "2026-08-10T00:00:00Z", "2026-09-10T00:00:00Z")},
    '${token4}','OPS-C3B','operator after webhook','op-a','${NOW}') r;`, "operator 3b");
  const [wh4, op4] = await Promise.all([webhook4, operator4]);
  assert(wh4.includes("processed") && rows(op4)[0].outcome === "stale_snapshot", `webhook-first outcomes ${wh4} ${op4}`);
  const state4 = await postgres.sql(`select status||'|'||provider_state_updated_at::text from public.subscriptions where id='${sub4}';`, "state 3b");
  assert(state4.startsWith("past_due|2026-08-20"), `webhook state must be intact, got ${state4}`);

  // ---- 4. operator reprocess vs the retry worker: a worker never claims an event the operator holds
  await postgres.sql(link("opworker", "a5"), "setup 4");
  const event5 = (await postgres.sql(ingest("opworker", "one", "past_due", "2026-08-05T00:00:00Z", null, false), "ingest 4")).split("\n").pop();
  await postgres.sql(`update public.billing_webhook_events set processing_status='manual_review',
    error_code='processor_retry_exhausted',processed_at='${NOW}' where id='${event5}';`, "park 4");
  const token5 = (await postgres.sql(`select review_token from public.plan_billing_event_reprocess_v1('test','${event5}','${NOW}');`, "plan 4")).trim();
  const operator5 = postgres.sql(`begin; select row_to_json(r) from public.apply_billing_event_reprocess_v1('test','${event5}','${token5}','OPS-C4','operator versus worker','op-a','${NOW}') r; select pg_sleep(1.5); commit;`, "operator 4");
  await sleep(400);
  const claimed = await postgres.sql(`select count(*) from public.claim_pending_billing_webhook_events_v2('test',10,'${NOW}') where webhook_event_id='${event5}';`, "worker claim");
  assert(claimed.trim() === "0", "retry worker claimed an event held by an operator reprocess");
  assert(rows(await operator5)[0].outcome === "reprocessed", "operator reprocess under worker contention failed");
  // a leased received event is owned by the worker and is not reprocessable by the operator
  const event6 = (await postgres.sql(ingest("opworker", "two", "past_due", "2026-08-06T00:00:00Z", null, false), "ingest 4b")).split("\n").pop();
  await postgres.sql(`select count(*) from public.claim_pending_billing_webhook_events_v2('test',10,'${NOW}');`, "worker lease");
  const verdict = (await postgres.sql(`select verdict from public.plan_billing_event_reprocess_v1('test','${event6}','${NOW}');`, "verdict 4b")).trim();
  assert(verdict === "not_manual_review", `leased received event verdict ${verdict}`);

  console.log("Billing operator recovery concurrency checks passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

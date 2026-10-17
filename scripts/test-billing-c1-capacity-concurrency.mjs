import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// C1 concurrency on a disposable PostgreSQL container only (never the persistent local database).
const postgres = createDisposableSupabasePostgres("rezervo-c1-capacity-concurrency");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); };
let counter = 0;

async function trialSalon(employees) {
  counter += 1;
  const n = String(counter).padStart(2, "0");
  const owner = `c1000000-0000-4000-8000-0000000000${n}`;
  const salon = `c2000000-0000-4000-8000-0000000000${n}`;
  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','c1-${n}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values('${salon}','${owner}','C1 ${n}','c1-concurrency-${n}');
    insert into public.employees(salon_id,full_name) select '${salon}','E'||g from generate_series(1,${employees}) g;`, `salon ${n}`);
  return { owner, salon };
}
// Each session reports its outcome as one line instead of failing the psql process.
const acquire = (s, plan, hold = 0) => `
  begin;
  do $$ declare r record; begin
    select * into r from public.acquire_billing_checkout_intent_v2('${s.salon}','${s.owner}',(select id from public.plans where slug='${plan}'),'lemonsqueezy');
    raise notice 'RESULT ok';
  exception when others then raise notice 'RESULT %', sqlerrm; end $$;
  select pg_sleep(${hold}); commit;`;
const insertEmployee = (s, hold = 0) => `
  begin;
  do $$ begin
    insert into public.employees(salon_id,full_name) values('${s.salon}','contender');
    raise notice 'RESULT ok';
  exception when others then raise notice 'RESULT %', sqlerrm; end $$;
  select pg_sleep(${hold}); commit;`;

async function session(sql, label) {
  // psql prints notices on stderr; the helper keeps stdout only, so read results back from a table instead.
  const wrapped = sql.replaceAll("raise notice 'RESULT ok';", `insert into public.c1_results(label,result) values('${label}','ok');`)
    .replaceAll("raise notice 'RESULT %', sqlerrm;", `insert into public.c1_results(label,result) values('${label}',sqlerrm);`);
  await postgres.sql(wrapped, label);
  return (await postgres.sql(`select result from public.c1_results where label='${label}';`, `${label} result`)).trim();
}

async function race(firstSql, firstLabel, secondSql, secondLabel) {
  const first = session(firstSql, firstLabel);
  await sleep(500);
  const second = session(secondSql, secondLabel);
  return Promise.all([first, second]);
}

const activeCount = async (s) => Number(await postgres.sql(`select count(*) from public.employees where salon_id='${s.salon}' and is_active;`, "count"));

try {
  await postgres.initialize();
  await postgres.sql(`
    create table public.c1_results(label text primary key, result text not null);
    insert into private.billing_runtime_config(singleton,environment) values(true,'test')
    on conflict(singleton) do update set environment='test';
    insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
      provider_product_id,provider_variant_id,provider_store_id,is_active)
    select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'product-'||p.slug,'variant-'||p.slug,'store-test',true
    from public.plans p where p.slug in ('starter','pro')
    on conflict(provider,environment,plan_id,billing_interval,currency) do update set
      provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
      provider_store_id=excluded.provider_store_id,is_active=true;`, "setup");

  // 3a. activation holds the capacity lock first: acquisition then sees 4 active and refuses
  let s = await trialSalon(3);
  let [emp, acq] = await race(insertEmployee(s, 1.5), "3a-employee", acquire(s, "starter"), "3a-acquire");
  assert(emp === "ok" && acq === "EMPLOYEE_OVER_TARGET_LIMIT", `3a employee=${emp} acquire=${acq}`);
  assert(await activeCount(s) === 4, "3a count");
  // 3b. acquisition holds the lock first: the employee insert then sees the reservation
  s = await trialSalon(3);
  [acq, emp] = await race(acquire(s, "starter", 1.5), "3b-acquire", insertEmployee(s), "3b-employee");
  assert(acq === "ok" && emp === "EMPLOYEE_PURCHASE_LIMIT_PENDING", `3b acquire=${acq} employee=${emp}`);
  assert(await activeCount(s) === 3, "3b count");

  // 4. created activation versus employee activation, both orders (2 active, Starter target 3)
  const createdFor = async (s, suffix) => {
    await postgres.sql(`select 1 from public.acquire_billing_checkout_intent_v2('${s.salon}','${s.owner}',(select id from public.plans where slug='starter'),'lemonsqueezy');`, "acq");
    const id = (await postgres.sql(`select id from public.billing_checkout_sessions where salon_id='${s.salon}' and status='creating';`, "checkout id")).trim();
    await postgres.sql(`update public.billing_checkout_sessions set status='open',provider_session_id='ps-${suffix}',
      checkout_url_hash=encode(digest('${suffix}','sha256'),'hex'),expires_at=now()+interval '30 minutes' where id='${id}';`, "open");
    const event = (await postgres.sql(`select event_id from public.ingest_billing_webhook_event_v2(
      'lemonsqueezy','test','subscription_created','subscriptions','sub-${suffix}',
      encode(digest('event-${suffix}','sha256'),'hex'),encode(digest('semantic-${suffix}','sha256'),'hex'),
      'received',null,true,'${id}','${s.salon}','starter',(select idempotency_key from public.billing_checkout_sessions where id='${id}'),
      'sub-${suffix}','order-${suffix}','customer-${suffix}','product-starter','variant-starter','active',
      now()-interval '1 hour',now()-interval '30 minutes',true,'ready',null,'store-test',now()+interval '30 days',null,false,null,null,null);`, "ingest")).trim();
    return event;
  };
  const processSql = (event, hold = 0) => `
    begin;
    do $$ declare r record; begin
      select * into r from public.process_billing_subscription_created_v2('${event}');
      insert into public.c1_results(label,result) values('PLACEHOLDER', r.outcome||coalesce(':'||r.error_code,''));
    exception when others then insert into public.c1_results(label,result) values('PLACEHOLDER',sqlerrm); end $$;
    select pg_sleep(${hold}); commit;`;
  const run = (sql, label) => postgres.sql(sql.replaceAll("PLACEHOLDER", label), label)
    .then(() => postgres.sql(`select result from public.c1_results where label='${label}';`, label)).then((v) => v.trim());

  s = await trialSalon(2);
  let event = await createdFor(s, "4a");
  let first = session(insertEmployee(s, 1.5), "4a-employee");
  await sleep(500);
  let second = run(processSql(event), "4a-process");
  let [e4a, p4a] = await Promise.all([first, second]);
  assert(e4a === "ok" && p4a === "processed", `4a employee=${e4a} process=${p4a}`);
  assert(await activeCount(s) === 3, "4a count");

  s = await trialSalon(2);
  event = await createdFor(s, "4b");
  first = run(processSql(event, 1.5), "4b-process");
  await sleep(500);
  second = session(insertEmployee(s), "4b-employee");
  const [p4b, e4b] = await Promise.all([first, second]);
  assert(p4b === "processed" && e4b === "ok", `4b process=${p4b} employee=${e4b}`);
  // Starter is now active with 3: the next one hits the plan limit
  const after = await session(insertEmployee(s), "4b-fourth");
  assert(after === "EMPLOYEE_LIMIT_REACHED", `4b fourth=${after}`);

  // 13. two operators recover the same capacity-parked activation; recovery vs a new acquisition
  s = await trialSalon(3);
  event = await createdFor(s, "13");
  await postgres.sql(`alter table public.employees disable trigger user;
    insert into public.employees(salon_id,full_name) values('${s.salon}','pre-c1 extra');
    alter table public.employees enable trigger user;`, "legacy extra");
  const parked = (await run(processSql(event), "13-park"));
  assert(parked === "manual_review:processor_checkout_capacity_exceeded", `13 park=${parked}`);
  await postgres.sql(`update public.employees set is_active=false where salon_id='${s.salon}' and full_name='pre-c1 extra';`, "reduce");
  const token = (await postgres.sql(`select review_token from public.plan_billing_event_reprocess_v1('test','${event}');`, "plan")).trim();
  const operator = (label, hold) => `
    begin;
    insert into public.c1_results(label,result)
      select '${label}', outcome from public.apply_billing_event_reprocess_v1('test','${event}','${token}','OPS-C13','parallel operator ${label}','op-${label}');
    select pg_sleep(${hold}); commit;`;
  first = postgres.sql(operator("13-op-a", 1.5), "op a").then(() => postgres.sql(`select result from public.c1_results where label='13-op-a';`, "a"));
  await sleep(500);
  second = postgres.sql(operator("13-op-b", 0), "op b").then(() => postgres.sql(`select result from public.c1_results where label='13-op-b';`, "b"));
  const third = session(acquire(s, "pro"), "13-acquire");
  const outcomes = (await Promise.all([first, second])).map((v) => v.trim()).sort();
  const acq13 = await third;
  assert(outcomes[0] === "no_change" && outcomes[1] === "reprocessed", `13 operators ${outcomes}`);
  assert(["BILLING_PURCHASE_ACTIVATION_PENDING", "BILLING_SUBSCRIPTION_ALREADY_ACTIVE"].includes(acq13), `13 concurrent acquisition ${acq13}`);
  const linked = (await postgres.sql(`select count(*) from public.subscriptions where salon_id='${s.salon}' and provider_subscription_id='sub-13' and status='active';`, "linked")).trim();
  assert(linked === "1", "13 activation applied exactly once");

  console.log("Billing C1 capacity concurrency checks passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// E1 resubscribe concurrency on a disposable PostgreSQL container only (never the persistent local database).
const postgres = createDisposableSupabasePostgres("rezervo-e1-resubscribe-concurrency");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); };
let counter = 0;
const nextId = () => String(910000 + (counter += 1));

// Provider-linked Starter salon whose expiry arrived through the real signed-updated processor.
async function expiredSalon() {
  const n = nextId();
  const owner = `e1000000-0000-4000-8000-000000${n}`;
  const salon = `e2000000-0000-4000-8000-000000${n}`;
  const pid = `1${n}`;
  const customer = `2${n}`;
  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','e1-${n}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values('${salon}','${owner}','E1 ${n}','e1-concurrency-${n}');
    update public.subscriptions set plan_id=(select id from public.plans where slug='starter'),status='active',
      billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='${customer}',
      provider_subscription_id='${pid}',trial_starts_at=null,trial_ends_at=null,
      current_period_starts_at=now()-interval '35 days',current_period_ends_at=now()-interval '5 days',
      provider_state_updated_at=now()-interval '35 days' where salon_id='${salon}';`, `salon ${n}`);
  const expired = await updatedEvent({ salon, pid, customer, status: "expired", updated: "now()-interval '1 hour'", ends: "now()-interval '2 hours'" });
  assert(await postgres.sql(`select outcome from public.process_billing_subscription_updated_v2('${expired}');`, "expire") === "processed", "expiry processed");
  return { owner, salon, pid, customer };
}

async function updatedEvent({ salon, pid, customer, status, updated, renews = "null", ends = "null" }) {
  const n = nextId();
  return postgres.sql(`select event_id from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_updated','subscriptions','${pid}',
    encode(digest('e1c-${n}','sha256'),'hex'),encode(digest('e1c-sem-${n}','sha256'),'hex'),
    'received',null,true,gen_random_uuid(),'${salon}','starter',gen_random_uuid(),
    '${pid}','order-${pid}','${customer}','1451030','2264918','${status}',
    now()-interval '35 days',${updated},true,'ready',null,'501229',${renews},${ends},
    ${status === "expired" || status === "cancelled"},null,null,null);`, "updated event");
}

async function createdEvent(checkout, pid, customer) {
  const n = nextId();
  return postgres.sql(`select i.event_id from public.billing_checkout_sessions c join public.plans p on p.id=c.requested_plan_id,
    lateral public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions','${pid}',
    encode(digest('e1c-created-${n}','sha256'),'hex'),encode(digest('e1c-created-sem-${n}','sha256'),'hex'),
    'received',null,true,c.id,c.salon_id,p.slug,c.idempotency_key,
    '${pid}','order-${pid}','${customer}','1451030',case p.slug when 'starter' then '2264918' else '2264940' end,'active',
    now()-interval '5 minutes',now()-interval '4 minutes',true,'ready',null,'501229',now()+interval '30 days',null,false,null,null,null) i
    where c.id='${checkout}';`, "created event");
}

async function openCheckout(checkout) {
  await postgres.sql(`update public.billing_checkout_sessions set status='open',provider_session_id=gen_random_uuid()::text,
    checkout_url_hash=encode(digest(id::text,'sha256'),'hex'),expires_at=clock_timestamp()+interval '30 minutes' where id='${checkout}';`, "open");
}

// Each session records its outcome in a results table instead of failing the psql process.
function guarded(label, body, hold) {
  return `
    begin;
    do $$ declare r record; begin
      ${body}
    exception when others then insert into public.e1_results(label,result) values('${label}',sqlerrm); end $$;
    select pg_sleep(${hold}); commit;`;
}
const acquire = (s, plan, label, hold = 0) => guarded(label, `
  select * into r from public.acquire_billing_checkout_intent_v3('${s.salon}','${s.owner}',(select id from public.plans where slug='${plan}'),'lemonsqueezy',true);
  insert into public.e1_results(label,result) values('${label}',r.acquisition_outcome||':'||r.checkout_session_id);`, hold);
const processCreated = (event, label, hold = 0) => guarded(label, `
  select * into r from public.process_billing_subscription_created_v2('${event}');
  insert into public.e1_results(label,result) values('${label}',r.outcome||coalesce(':'||r.error_code,''));`, hold);
const processUpdated = (event, label, hold = 0) => guarded(label, `
  select * into r from public.process_billing_subscription_updated_v2('${event}');
  insert into public.e1_results(label,result) values('${label}',r.outcome||coalesce(':'||r.error_code,''));`, hold);

async function session(sql, label) {
  await postgres.sql(sql, label);
  return (await postgres.sql(`select result from public.e1_results where label='${label}';`, `${label} result`)).trim();
}
async function race(firstSql, firstLabel, secondSql, secondLabel) {
  const first = session(firstSql, firstLabel);
  await sleep(500);
  const second = session(secondSql, secondLabel);
  return Promise.all([first, second]);
}
const current = (s) => postgres.sql(`select status||':'||provider_subscription_id from public.subscriptions where salon_id='${s.salon}';`, "current");
const generations = (s) => postgres.sql(`select count(*) from public.billing_subscription_provider_generations where salon_id='${s.salon}';`, "generations");

try {
  await postgres.initialize();
  await postgres.sql(`
    create table public.e1_results(label text primary key, result text not null);
    insert into private.billing_runtime_config(singleton,environment) values(true,'test')
    on conflict(singleton) do update set environment='test';
    insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
      provider_product_id,provider_variant_id,provider_store_id,is_active)
    select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'1451030',
      case p.slug when 'starter' then '2264918' else '2264940' end,'501229',true
    from public.plans p where p.slug in ('starter','pro')
    on conflict(provider,environment,plan_id,billing_interval,currency) do update set
      provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
      provider_store_id=excluded.provider_store_id,is_active=true;`, "setup");

  // 1. two parallel resubscribe requests: at most one intent
  let s = await expiredSalon();
  const [first, second] = await race(acquire(s, "pro", "1-first", 1.5), "1-first", acquire(s, "pro", "1-second"), "1-second");
  assert(first.startsWith("created:") && second === `existing:${first.split(":")[1]}`, `1 first=${first} second=${second}`);
  assert(await postgres.sql(`select count(*) from public.billing_checkout_sessions where salon_id='${s.salon}';`, "count") === "1", "1 one intent");

  // 2. activation of B versus a late, newer-timestamped delivery of the old identity, both orders
  for (const order of ["activation-first", "old-first"]) {
    s = await expiredSalon();
    const checkout = (await session(acquire(s, "starter", `2-${order}-acq`), `2-${order}-acq`)).split(":")[1];
    await openCheckout(checkout);
    const newPid = `3${nextId()}`;
    const created = await createdEvent(checkout, newPid, `4${nextId()}`);
    const old = await updatedEvent({ ...s, status: "active", updated: "now()+interval '1 hour'", renews: "now()+interval '40 days'" });
    const [a, b] = order === "activation-first"
      ? await race(processCreated(created, `2-${order}-c`, 1.5), `2-${order}-c`, processUpdated(old, `2-${order}-u`), `2-${order}-u`)
      : await race(processUpdated(old, `2-${order}-u`, 1.5), `2-${order}-u`, processCreated(created, `2-${order}-c`), `2-${order}-c`);
    const createdOutcome = order === "activation-first" ? a : b;
    const oldOutcome = order === "activation-first" ? b : a;
    assert(createdOutcome === "processed", `2 ${order} created=${createdOutcome}`);
    // old first: it is still the current identity and expired -> refused; activation first: history
    assert(order === "activation-first"
      ? oldOutcome === "stale_ignored"
      : oldOutcome === "manual_review:processor_updated_expired_reactivation_unsupported", `2 ${order} old=${oldOutcome}`);
    assert(await current(s) === `active:${newPid}`, `2 ${order} current`);
    assert(await generations(s) === "1", `2 ${order} history`);
  }

  // 3. activation versus a new resubscribe request, both orders
  s = await expiredSalon();
  let checkout = (await session(acquire(s, "starter", "3a-acq"), "3a-acq")).split(":")[1];
  await openCheckout(checkout);
  let created = await createdEvent(checkout, `3${nextId()}`, s.customer);
  let [c, r] = await race(processCreated(created, "3a-created", 1.5), "3a-created", acquire(s, "starter", "3a-again"), "3a-again");
  assert(c === "processed" && r === "BILLING_SUBSCRIPTION_ALREADY_ACTIVE", `3a created=${c} acquire=${r}`);

  s = await expiredSalon();
  checkout = (await session(acquire(s, "starter", "3b-acq"), "3b-acq")).split(":")[1];
  await openCheckout(checkout);
  created = await createdEvent(checkout, `3${nextId()}`, s.customer);
  [r, c] = await race(acquire(s, "starter", "3b-again", 1.5), "3b-again", processCreated(created, "3b-created"), "3b-created");
  // the signed created is already durable (received): it is a pending activation, never a reason for a new intent
  assert(r === "BILLING_PURCHASE_ACTIVATION_PENDING" && c === "processed", `3b acquire=${r} created=${c}`);
  assert(await postgres.sql(`select count(*) from public.billing_checkout_sessions where salon_id='${s.salon}';`, "count") === "1", "3b one intent");

  console.log("Billing E1 resubscribe concurrency passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

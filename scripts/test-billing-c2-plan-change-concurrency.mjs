import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// C2 plan-change concurrency on a disposable PostgreSQL container only (never the persistent
// local database). Each race holds the first transaction open with pg_sleep so the second one
// really waits on the documented lock order; every session records its own outcome or error
// (a deadlock would be recorded as an error and fail the assertion).
const postgres = createDisposableSupabasePostgres("rezervo-c2-plan-change-concurrency");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); };
const one = async (sql, label) => (await postgres.sql(sql, label)).trim();

const setup = `
  create schema c2t;
  create table c2t.clock as select date_trunc('minute', now()) as t0;
  create table c2t.results(label text primary key, result text not null);
  create sequence c2t.ids start 800001;
  create function c2t.t(p interval default interval '0') returns timestamptz language sql stable as $$ select t0 + p from c2t.clock $$;
  create function c2t.b(p interval default interval '0') returns timestamptz language sql stable as $$ select t0 + interval '30 days' + p from c2t.clock $$;
  create function c2t.variant(p_slug text) returns text language sql as $$ select case p_slug when 'starter' then '2264918' else '2264940' end $$;
  insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active)
  select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'1451030',c2t.variant(p.slug),'501229',true
  from public.plans p where p.slug in ('starter','pro')
  on conflict(provider,environment,plan_id,billing_interval,currency) do update set
    provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=true;
  insert into private.billing_runtime_config(singleton,environment) values(true,'test')
  on conflict(singleton) do update set environment='test';

  create table c2t.salons(label text primary key, owner_id uuid, salon_id uuid, sub_id uuid, pid text, customer text, change_id uuid);
  create function c2t.mk(p_label text, p_slug text, p_employees int) returns void language plpgsql as $$
  declare v_owner uuid := gen_random_uuid(); v_salon uuid := gen_random_uuid(); v_sub uuid; v_pid text; v_customer text;
  begin
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,p_label,'c2c-'||p_label);
    select id into v_sub from public.subscriptions where salon_id=v_salon;
    v_pid := nextval('c2t.ids')::text; v_customer := nextval('c2t.ids')::text;
    update public.subscriptions set plan_id=(select id from public.plans where slug=p_slug),status='active',
      billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id=v_customer,provider_subscription_id=v_pid,
      trial_starts_at=null,trial_ends_at=null,current_period_starts_at=c2t.t(interval '-1 day'),current_period_ends_at=c2t.b(),
      provider_state_updated_at=c2t.t(interval '-1 day')+interval '30 seconds',cancel_at_period_end=false,cancelled_at=null
    where id=v_sub;
    if p_employees > 0 then
      alter table public.employees disable trigger user;
      insert into public.employees(salon_id,full_name) select v_salon,'E'||g from generate_series(1,p_employees) g;
      alter table public.employees enable trigger user;
    end if;
    insert into c2t.salons values(p_label,v_owner,v_salon,v_sub,v_pid,v_customer,null);
  end $$;
  create function c2t.request(p_label text, p_target text) returns uuid language plpgsql as $$
  declare s c2t.salons; v_sub public.subscriptions; v_token text; v_id uuid;
  begin
    select * into s from c2t.salons where label=p_label;
    select * into v_sub from public.subscriptions where id=s.sub_id;
    v_token := private.billing_subscription_state_fingerprint_v1(v_sub);
    select plan_change_id into v_id from public.request_billing_plan_change_v1(
      s.salon_id,s.owner_id,(select id from public.plans where slug=p_target),v_token,s.pid,s.customer,'501229',true,'1451030',
      c2t.variant((select slug from public.plans where id=v_sub.plan_id)),'active',false,null,null,v_sub.current_period_ends_at,null,
      v_sub.provider_state_updated_at,c2t.t(interval '-1 minute'),c2t.t());
    update c2t.salons set change_id=v_id where label=p_label;
    return v_id;
  end $$;
  create function c2t.confirm(p_label text, p_slug text) returns text language plpgsql as $$
  declare s c2t.salons; r record;
  begin
    select * into s from c2t.salons where label=p_label;
    select * into r from public.record_billing_plan_change_provider_result_v1('test',s.change_id,'accepted',s.pid,s.customer,'501229',true,
      '1451030',c2t.variant(p_slug),'active',false,null,null,c2t.b(),null,c2t.t(interval '5 seconds'),c2t.t(interval '10 seconds'));
    return r.plan_change_status;
  end $$;
  create function c2t.event(p_label text, p_suffix text, p_slug text, p_updated timestamptz, p_renews timestamptz) returns uuid language plpgsql as $$
  declare s c2t.salons; v_id uuid;
  begin
    select * into s from c2t.salons where label=p_label;
    select event_id into v_id from public.ingest_billing_webhook_event_v2('lemonsqueezy','test','subscription_updated','subscriptions',s.pid,
      encode(digest('c2c-event-'||p_suffix,'sha256'),'hex'),encode(digest('c2c-sem-'||p_suffix,'sha256'),'hex'),
      'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),s.pid,'order-'||s.pid,s.customer,
      '1451030',c2t.variant(p_slug),'active',c2t.t(interval '-1 day'),p_updated,true,'ready',null,'501229',p_renews,null,false,null,null,null);
    return v_id;
  end $$;
  create function c2t.invoice(p_label text, p_invoice text) returns text language plpgsql as $$
  declare s c2t.salons; v_out text;
  begin
    select * into s from c2t.salons where label=p_label;
    select outcome into v_out from public.ingest_billing_subscription_invoice_evidence_v1('lemonsqueezy','test','subscription_payment_success',
      'subscription-invoices',p_invoice,encode(digest('c2c-inv-'||p_invoice,'sha256'),'hex'),encode(digest('c2c-inv-sem-'||p_invoice,'sha256'),'hex'),
      true,p_invoice,s.pid,s.customer,'501229','renewal','paid',c2t.b(interval '10 seconds'),c2t.b(interval '30 seconds'),c2t.b(interval '3 minutes'));
    return v_out;
  end $$;
  create function c2t.state(p_label text) returns text language sql as $$
    select c.status||':'||p.slug||':'||(sub.current_period_ends_at>c2t.b())::text
    from c2t.salons s join public.billing_subscription_plan_changes c on c.id=s.change_id
    join public.subscriptions sub on sub.id=s.sub_id join public.plans p on p.id=sub.plan_id where s.label=p_label $$;`;

// one transaction per session; the outcome (or error) is recorded, then the session holds for `hold` seconds
const tx = (label, body, hold = 0) => `
  begin;
  do $$ declare v_out text; begin
    ${body}
    insert into c2t.results(label,result) values('${label}',coalesce(v_out,'ok'));
  exception when others then insert into c2t.results(label,result) values('${label}',sqlerrm); end $$;
  select pg_sleep(${hold}); commit;`;
const result = (label) => one(`select result from c2t.results where label='${label}';`, `${label} result`);
async function race(first, firstLabel, second, secondLabel) {
  const a = postgres.sql(first, firstLabel);
  await sleep(500);
  const b = postgres.sql(second, secondLabel);
  await Promise.all([a, b]);
  return [await result(firstLabel), await result(secondLabel)];
}
const processBody = (event) => `select r.outcome||coalesce(':'||r.error_code,'') into v_out
  from public.process_billing_subscription_updated_v2('${event}', c2t.b(interval '2 minutes')) r;`;
const activeCount = async (label) => Number(await one(`select count(*) from public.employees e join c2t.salons s on s.salon_id=e.salon_id where s.label='${label}' and e.is_active;`, "count"));

try {
  await postgres.initialize();
  await postgres.sql(setup, "setup");

  // K1. downgrade request versus a concurrent employee activation, both lock orders (Pro, 3 active)
  await one(`select c2t.mk('k1a','pro',3);`, "k1a");
  let [emp, req] = await race(
    tx("k1a-employee", `insert into public.employees(salon_id,full_name) select salon_id,'contender' from c2t.salons where label='k1a';`, 1.5), "k1a-employee",
    tx("k1a-request", `perform c2t.request('k1a','starter');`), "k1a-request");
  assert(emp === "ok" && req === "EMPLOYEE_OVER_TARGET_LIMIT", `K1a employee=${emp} request=${req}`);
  assert(await activeCount("k1a") === 4, "K1a count");
  await one(`select c2t.mk('k1b','pro',3);`, "k1b");
  [req, emp] = await race(
    tx("k1b-request", `perform c2t.request('k1b','starter');`, 1.5), "k1b-request",
    tx("k1b-employee", `insert into public.employees(salon_id,full_name) select salon_id,'contender' from c2t.salons where label='k1b';`), "k1b-employee");
  assert(req === "ok" && emp === "EMPLOYEE_PLAN_CHANGE_LIMIT_PENDING", `K1b request=${req} employee=${emp}`);
  assert(await activeCount("k1b") === 3, "K1b count");

  // K2. two concurrent requests for the same subscription: exactly one intent
  await one(`select c2t.mk('k2','starter',0);`, "k2");
  const [r1, r2] = await race(
    tx("k2-a", `perform c2t.request('k2','pro');`, 1.5), "k2-a",
    tx("k2-b", `perform c2t.request('k2','pro');`), "k2-b");
  const blocking = await one(`select count(*) from public.billing_subscription_plan_changes c join c2t.salons s on s.sub_id=c.subscription_id where s.label='k2';`, "k2 count");
  assert(r1 === "ok" && ["BILLING_PLAN_CHANGE_PENDING", "BILLING_PLAN_CHANGE_STATE_CHANGED"].includes(r2) && blocking === "1", `K2 a=${r1} b=${r2} rows=${blocking}`);

  // K3. renewal invoice versus renewed-period webhook, both orders and repeated: one completion
  for (let i = 0; i < 3; i += 1) {
    for (const order of ["updated-first", "invoice-first"]) {
      const label = `k3-${order}-${i}`;
      await one(`select c2t.mk('${label}','starter',0); select c2t.request('${label}','pro'); select c2t.confirm('${label}','pro');`, label);
      const event = await one(`select c2t.event('${label}','${label}-e2','pro',c2t.b(interval '1 minute'),c2t.b(interval '1 month'));`, "event");
      const invoice = await one(`select nextval('c2t.ids');`, "invoice id");
      const updatedTx = (hold) => tx(`${label}-updated`, processBody(event), hold);
      const invoiceTx = (hold) => tx(`${label}-invoice`, `v_out := c2t.invoice('${label}','${invoice}');`, hold);
      const [first, second] = order === "updated-first"
        ? await race(updatedTx(1.5), `${label}-updated`, invoiceTx(0), `${label}-invoice`)
        : await race(invoiceTx(1.5), `${label}-invoice`, updatedTx(0), `${label}-updated`);
      const outcomes = [first, second].sort().join(",");
      assert(outcomes === "invoice_evidence_recorded,processed", `K3 ${label} outcomes=${outcomes}`);
      const state = await one(`select c2t.state('${label}');`, "state");
      assert(state === "completed:pro:true", `K3 ${label} state=${state}`);
    }
  }

  // K4. duplicate invoice deliveries in parallel: one evidence row, one completion
  await one(`select c2t.mk('k4','starter',0); select c2t.request('k4','pro'); select c2t.confirm('k4','pro');`, "k4");
  const k4event = await one(`select c2t.event('k4','k4-e2','pro',c2t.b(interval '1 minute'),c2t.b(interval '1 month'));`, "k4 event");
  await one(`select outcome from public.process_billing_subscription_updated_v2('${k4event}', c2t.b(interval '2 minutes'));`, "k4 e2");
  const k4invoice = await one(`select nextval('c2t.ids');`, "k4 invoice");
  const [d1, d2] = await race(
    tx("k4-a", `v_out := c2t.invoice('k4','${k4invoice}');`, 1.5), "k4-a",
    tx("k4-b", `v_out := c2t.invoice('k4','${k4invoice}');`), "k4-b");
  const evidenceRows = await one(`select count(*) from public.billing_webhook_subscription_invoice_facts where provider_invoice_id='${k4invoice}';`, "k4 rows");
  assert([d1, d2].sort().join(",") === "invoice_evidence_already_recorded,invoice_evidence_recorded" && evidenceRows === "1", `K4 ${d1},${d2} rows=${evidenceRows}`);
  assert(await one(`select c2t.state('k4');`, "k4 state") === "completed:pro:true", "K4 completed once");

  // K5. operator snapshot apply versus the same-state webhook: no deadlock, one apply, same final state
  await one(`select c2t.mk('k5','starter',0); select c2t.request('k5','pro'); select c2t.confirm('k5','pro');`, "k5");
  const k5invoice = await one(`select nextval('c2t.ids');`, "k5 invoice");
  await one(`select c2t.invoice('k5','${k5invoice}');`, "k5 invoice ingest");
  const k5event = await one(`select c2t.event('k5','k5-e2','pro',c2t.b(interval '1 minute'),c2t.b(interval '1 month'));`, "k5 event");
  const snapshotArgs = `'test',s.sub_id,s.pid,s.customer,'501229',true,'1451030','2264940','active',false,null,null,null,c2t.b(interval '1 month'),null,c2t.t(interval '-1 day'),c2t.b(interval '1 minute')`;
  const token = await one(`select r.review_token from c2t.salons s cross join lateral public.plan_billing_subscription_recovery_v1(${snapshotArgs},c2t.b(interval '2 minutes')) r where s.label='k5';`, "k5 plan");
  const [snap, hook] = await race(
    tx("k5-snapshot", `select r.outcome into v_out from c2t.salons s cross join lateral public.apply_billing_subscription_recovery_v1(${snapshotArgs},'${token}','OPS-C2K5','concurrent snapshot apply','c2-k5',c2t.b(interval '2 minutes')) r where s.label='k5';`, 1.5), "k5-snapshot",
    tx("k5-webhook", processBody(k5event)), "k5-webhook");
  assert(snap === "applied" && hook === "already_applied", `K5 snapshot=${snap} webhook=${hook}`);
  assert(await one(`select c2t.state('k5');`, "k5 state") === "completed:pro:true", "K5 completed once");

  // K6. provider PATCH result versus the confirming webhook: both commit, confirmed once
  await one(`select c2t.mk('k6','starter',0); select c2t.request('k6','pro');`, "k6");
  const k6event = await one(`select c2t.event('k6','k6-e1','pro',c2t.t(interval '5 seconds'),c2t.b());`, "k6 event");
  const [res, e1] = await race(
    tx("k6-result", `v_out := c2t.confirm('k6','pro');`, 1.5), "k6-result",
    tx("k6-webhook", `select r.outcome into v_out from public.process_billing_subscription_updated_v2('${k6event}', c2t.t(interval '20 seconds')) r;`), "k6-webhook");
  assert(res === "confirmed" && e1 === "processed", `K6 result=${res} webhook=${e1}`);
  assert(await one(`select c2t.state('k6');`, "k6 state") === "confirmed:starter:false", "K6 confirmed, plan unchanged");

  // K7. operator record_observed (C2 recovery, migration 048) versus the confirming webhook, both orders
  for (const order of ["operator-first", "webhook-first"]) {
    const label = `k7-${order}`;
    await one(`select c2t.mk('${label}','starter',0); select c2t.request('${label}','pro');
      select 1 from public.record_billing_plan_change_provider_result_v1('test',(select change_id from c2t.salons where label='${label}'),'ambiguous',
        null,null,null,null,null,null,null,null,null,null,null,null,null,c2t.t(interval '1 second'));`, label);
    const snap = `s.pid,s.customer,'501229',true,'1451030','2264940','active',false,null,null,null,c2t.b(),null,c2t.t(interval '-1 day'),c2t.t(interval '5 seconds')`;
    const token = await one(`select r.review_token from c2t.salons s cross join lateral public.plan_billing_plan_change_recovery_v1('test',s.change_id,${snap},c2t.t(interval '1 minute')) r where s.label='${label}';`, "k7 plan");
    const event = await one(`select c2t.event('${label}','${label}-e1','pro',c2t.t(interval '6 seconds'),c2t.b());`, "k7 event");
    const operatorTx = (hold) => tx(`${label}-operator`, `select r.outcome into v_out from c2t.salons s cross join lateral public.apply_billing_plan_change_recovery_v1('test',s.change_id,${snap},'${token}','OPS-K7','concurrent operator recovery','c2-k7',c2t.t(interval '1 minute')) r where s.label='${label}';`, hold);
    const webhookTx = (hold) => tx(`${label}-webhook`, `select r.outcome||coalesce(':'||r.error_code,'') into v_out from public.process_billing_subscription_updated_v2('${event}', c2t.t(interval '1 minute')) r;`, hold);
    const [first, second] = order === "operator-first"
      ? await race(operatorTx(1.5), `${label}-operator`, webhookTx(0), `${label}-webhook`)
      : await race(webhookTx(1.5), `${label}-webhook`, operatorTx(0), `${label}-operator`);
    const operator = order === "operator-first" ? first : second;
    const webhook = order === "operator-first" ? second : first;
    assert(webhook === "processed", `K7 ${order} webhook=${webhook}`);
    assert(order === "operator-first" ? operator === "recorded" : ["precondition_unmet", "stale"].includes(operator), `K7 ${order} operator=${operator}`);
    assert(await one(`select c2t.state('${label}');`, "k7 state") === "confirmed:starter:false", `K7 ${order} confirmed once, plan unchanged`);
  }

  // K8. resolve_not_applied: two operators at once, and operator versus a concurrent invoice/evaluator
  const renewedOnPrevious = async (label) => {
    await one(`select c2t.mk('${label}','starter',0); select c2t.request('${label}','pro');
      select 1 from public.record_billing_plan_change_provider_result_v1('test',(select change_id from c2t.salons where label='${label}'),'ambiguous',
        null,null,null,null,null,null,null,null,null,null,null,null,null,c2t.t(interval '1 second'));`, label);
    const renewal = await one(`select c2t.event('${label}','${label}-renew','starter',c2t.b(interval '1 minute'),c2t.b(interval '1 month'));`, "renewal event");
    await one(`select outcome from public.process_billing_subscription_updated_v2('${renewal}', c2t.b(interval '2 minutes'));`, "renewal");
    const invoice = await one(`select nextval('c2t.ids');`, "invoice id");
    await one(`select c2t.invoice('${label}','${invoice}');`, "invoice");
    const snap = `s.pid,s.customer,'501229',true,'1451030','2264918','active',false,null,null,null,c2t.b(interval '1 month'),null,c2t.t(interval '-1 day'),c2t.b(interval '1 minute')`;
    const token = await one(`select r.review_token from c2t.salons s cross join lateral public.plan_billing_plan_change_recovery_v1('test',s.change_id,${snap},c2t.b(interval '1 hour')) r where s.label='${label}';`, "plan");
    const applyTx = (name, hold) => tx(name, `select r.outcome into v_out from c2t.salons s cross join lateral public.apply_billing_plan_change_recovery_v1('test',s.change_id,${snap},'${token}','OPS-K8','concurrent operator resolution','c2-k8',c2t.b(interval '1 hour')) r where s.label='${label}';`, hold);
    return { invoice, applyTx };
  };
  const claims = (invoice) => one(`select count(*) from public.billing_subscription_plan_changes where renewal_invoice_id='${invoice}';`, "claims");
  const status = (label) => one(`select c.status||':'||(sub.current_period_ends_at=c2t.b(interval '1 month'))::text from c2t.salons s join public.billing_subscription_plan_changes c on c.id=s.change_id join public.subscriptions sub on sub.id=s.sub_id where s.label='${label}';`, "status");

  const k8a = await renewedOnPrevious("k8a");
  const ops = (await race(k8a.applyTx("k8a-op1", 1.5), "k8a-op1", k8a.applyTx("k8a-op2", 0), "k8a-op2")).sort();
  assert(ops.join(",") === "no_change,resolved_not_applied", `K8a operators=${ops}`);
  assert(await claims(k8a.invoice) === "1" && await status("k8a") === "not_applied:true", "K8a resolved once, invoice claimed once");

  for (const order of ["operator-first", "invoice-first"]) {
    const label = `k8b-${order}`;
    const k8b = await renewedOnPrevious(label);
    const extra = await one(`select nextval('c2t.ids');`, "extra invoice");
    const invoiceTx = (hold) => tx(`${label}-invoice`, `v_out := c2t.invoice('${label}','${extra}');`, hold);
    const [first, second] = order === "operator-first"
      ? await race(k8b.applyTx(`${label}-op`, 1.5), `${label}-op`, invoiceTx(0), `${label}-invoice`)
      : await race(invoiceTx(1.5), `${label}-invoice`, k8b.applyTx(`${label}-op`, 0), `${label}-op`);
    const operator = order === "operator-first" ? first : second;
    const invoice = order === "operator-first" ? second : first;
    assert(invoice === "invoice_evidence_recorded", `K8b ${order} invoice=${invoice}`);
    assert(operator === "resolved_not_applied", `K8b ${order} operator=${operator}`);
    assert(await status(label) === "not_applied:true", `K8b ${order} final state`);
    assert(await claims(k8b.invoice) === "1" && await claims(extra) === "0", `K8b ${order} invoice claims`);
  }

  console.log("Billing C2 plan change concurrency checks passed on disposable PostgreSQL.");
} finally {
  postgres.cleanup();
}

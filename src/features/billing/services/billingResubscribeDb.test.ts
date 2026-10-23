import assert from "node:assert/strict";
import test from "node:test";

import { createDisposableSupabasePostgres } from "../../../../scripts/lib/disposable-supabase-postgres.mjs";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";
import type { BillingProvider, CreateCheckoutSessionInput } from "../providers/billingProvider.ts";
import { SupabaseBillingPlanChangeRepository } from "../planChange/supabaseBillingPlanChangeRepositoryCore.ts";
import type { PlanChangeDatabaseClient } from "../planChange/supabaseBillingPlanChangeRepositoryCore.ts";
import { createBillingCheckout, type BillingCheckoutRepository } from "./billingCheckoutCore.ts";
import { parseBillingCheckoutIntentAcquisition } from "./billingCheckoutIntent.ts";
import { resolveResubscribeOverview } from "./billingResubscribeAvailability.ts";
import { resolveSubscriptionAccess, type SubscriptionAccessPlan } from "./subscriptionAccess.ts";

// E1 over the real RPCs on a disposable PostgreSQL container only; the provider is a local mock.
const postgres = createDisposableSupabasePostgres("rezervo-e1-resubscribe-ts");
await postgres.initialize();
test.after(() => postgres.cleanup());

const sql = (text: string) => postgres.sql(text, "e1-ts");
const json = async <T>(text: string): Promise<T> => JSON.parse(await sql(text)) as T;
const lit = (value: unknown) => value === null || value === undefined ? "null"
  : typeof value === "boolean" || typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
// psql runs in its own session; errors are reported as text instead of failing the process.
async function rpc(name: string, args: Record<string, unknown>) {
  const call = Object.entries(args).map(([key, value]) => `${key} => ${lit(value)}`).join(", ");
  const out = await sql(`
    create temp table if not exists e1_out(result json, error text);
    truncate e1_out;
    do $$ begin
      insert into e1_out(result) select coalesce(json_agg(r), '[]'::json) from public.${name}(${call.replaceAll("$$", "")}) r;
    exception when others then insert into e1_out(error) values (sqlerrm); end $$;
    select json_build_object('data', result, 'error', error) from e1_out;`);
  return JSON.parse(out.split("\n").pop()!) as { data: unknown; error: string | null };
}

const capabilities = { canUseStatistics: true, canUseAiReceptionist: false, canUseWhatsApp: false, canUseInstagram: false, canUseMarketing: false, canUseSmsReminders: true, maxMonthlyBookings: null, maxAiMessages: 0, maxMonthlyReminders: null };
const plans: Record<string, SubscriptionAccessPlan> = {
  starter: { ...capabilities, code: "starter", name: "Starter", isActive: true, maxEmployees: 3 },
  pro: { ...capabilities, code: "pro", name: "Pro", isActive: true, maxEmployees: 10 },
};

let counter = 0;
async function expiredSalon(employees = 0) {
  counter += 1;
  const n = String(counter).padStart(2, "0");
  const owner = `e1700000-0000-4000-8000-0000000000${n}`;
  const salonId = `e1710000-0000-4000-8000-0000000000${n}`;
  const pid = String(920000 + counter);
  const customer = String(930000 + counter);
  await sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','e1ts-${n}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values('${salonId}','${owner}','E1 TS ${n}','e1-ts-${n}');
    update public.subscriptions set plan_id=(select id from public.plans where slug='starter'),status='active',billing_provider='lemonsqueezy',
      billing_environment='test',provider_customer_id='${customer}',provider_subscription_id='${pid}',trial_starts_at=now()-interval '80 days',
      trial_ends_at=now()-interval '66 days',current_period_starts_at=now()-interval '35 days',current_period_ends_at=now()-interval '5 days',
      provider_state_updated_at=now()-interval '35 days' where salon_id='${salonId}';
    alter table public.employees disable trigger user;
    insert into public.employees(salon_id,full_name) select '${salonId}','E'||g from generate_series(1,${employees}) g;
    alter table public.employees enable trigger user;
    select r.outcome from public.ingest_billing_webhook_event_v2('lemonsqueezy','test','subscription_updated','subscriptions','${pid}',
      encode(digest('e1ts-exp-${n}','sha256'),'hex'),encode(digest('e1ts-exp-sem-${n}','sha256'),'hex'),'received',null,true,
      gen_random_uuid(),'${salonId}','starter',gen_random_uuid(),'${pid}','order-${pid}','${customer}','1451030','2264918','expired',
      now()-interval '35 days',now()-interval '1 hour',true,'ready',null,'501229',null,now()-interval '2 hours',true,null,null,null) e
    cross join lateral public.process_billing_subscription_updated_v2(e.event_id) r;`);
  return { owner, salonId, pid, customer };
}
type Salon = Awaited<ReturnType<typeof expiredSalon>>;

// Minimal repository over the real acquisition RPC (the production one is server-only).
function repository(allowResubscribe: boolean): BillingCheckoutRepository {
  const unused = () => { throw new Error("not used by this flow"); };
  return {
    isSalonOwner: async (salonId, actor) => (await sql(`select count(*) from public.salons where id='${salonId}' and owner_id='${actor}';`)) === "1",
    hasActiveOverride: async (salonId) => (await sql(`select count(*) from public.billing_access_overrides where salon_id='${salonId}' and enabled and starts_at<=now() and (ends_at is null or ends_at>now());`)) !== "0",
    getPriceMapping: async (planCode) => {
      const row = await json<Record<string, string | number | boolean>>(`select json_build_object('id',m.id,'planId',p.id,'planCode',p.slug,'planActive',p.is_active,
        'planMonthlyPrice',p.monthly_price,'planCurrency',p.currency,'mappingActive',m.is_active,'mappingAmount',m.amount,'mappingCurrency',m.currency,
        'providerVariantId',m.provider_variant_id,'providerStoreId',m.provider_store_id,'environment',m.environment)
        from public.billing_provider_prices m join public.plans p on p.id=m.plan_id where p.slug='${planCode}' and m.environment='test';`);
      return { ...row, planMonthlyPrice: Number(row.planMonthlyPrice), mappingAmount: Number(row.mappingAmount) } as never;
    },
    acquireCheckoutIntent: async (input) => {
      const { data, error } = await rpc("acquire_billing_checkout_intent_v3", {
        p_salon_id: input.salonId, p_actor_profile_id: input.actorProfileId, p_requested_plan_id: input.planId,
        p_provider: "lemonsqueezy", p_allow_resubscribe: allowResubscribe,
      });
      if (error) {
        if (error.startsWith("BILLING_RECONCILIATION_REQUIRED_")) throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
        throw new BillingCheckoutError(error as never, 409);
      }
      return parseBillingCheckoutIntentAcquisition((data as unknown[])[0], "test", input.salonId);
    },
    getCheckoutSessionById: unused, findByIdempotencyKey: unused, findReusableOpenSession: unused, markExpired: unused, insertCreating: unused,
    markOpen: async (input) => { await sql(`update public.billing_checkout_sessions set status='open',provider_session_id='${input.providerSessionId}',
      checkout_url_hash='${input.checkoutUrlHash}',expires_at='${input.expiresAt}' where id='${input.id}' and status='creating';`); },
    markFailed: unused,
  };
}

function mockProvider() {
  const calls: CreateCheckoutSessionInput[] = [];
  const provider: BillingProvider = {
    createCheckoutSession: async (input) => {
      calls.push(input);
      return { provider: "lemonsqueezy", providerSessionId: crypto.randomUUID(), checkoutUrl: `https://checkout.example.test/${input.checkoutSessionId}`,
        expiresAt: input.expiresAt, environment: "test" };
    },
  };
  return { calls, provider };
}

const runtime = { appUrl: "https://app.example.test", storeId: "501229", environment: "test" as const, liveAllowedSalonIds: null, now: () => new Date() };
const checkout = (s: Salon, planCode: "starter" | "pro", allow: boolean, provider: BillingProvider) =>
  createBillingCheckout({ salonId: s.salonId, actorProfileId: s.owner, planCode }, repository(allow), provider, runtime);
const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error) => error instanceof BillingCheckoutError ? error.code : String(error));

async function activate(s: Salon, newPid: string, newCustomer: string) {
  return sql(`select r.outcome from public.billing_checkout_sessions c join public.plans p on p.id=c.requested_plan_id,
    lateral public.ingest_billing_webhook_event_v2('lemonsqueezy','test','subscription_created','subscriptions','${newPid}',
      encode(digest('e1ts-c-${newPid}','sha256'),'hex'),encode(digest('e1ts-c-sem-${newPid}','sha256'),'hex'),'received',null,true,
      c.id,c.salon_id,p.slug,c.idempotency_key,'${newPid}','order-${newPid}','${newCustomer}','1451030',
      case p.slug when 'starter' then '2264918' else '2264940' end,'active',now()-interval '5 minutes',now()-interval '4 minutes',true,'ready',null,
      '501229',now()+interval '30 days',null,false,null,null,null) e
    cross join lateral public.process_billing_subscription_created_v2(e.event_id) r
    where c.salon_id='${s.salonId}' and c.status='open';`);
}

async function parity(s: Salon) {
  const { row, db } = await json<{ row: Record<string, string | null>; db: { full: boolean; reason: string; slug: string } }>(`select json_build_object(
    'row', (select json_build_object('status',s.status,'trialEndsAt',s.trial_ends_at,'currentPeriodEndsAt',s.current_period_ends_at,
      'billingProvider',s.billing_provider,'billingEnvironment',s.billing_environment,'providerCustomerId',s.provider_customer_id,
      'providerSubscriptionId',s.provider_subscription_id,'plan',p.slug) from public.subscriptions s join public.plans p on p.id=s.plan_id where s.salon_id='${s.salonId}'),
    'db', (select json_build_object('full',a.has_full_access,'reason',a.access_reason,'slug',a.effective_plan_slug) from public.resolve_salon_access_v1('${s.salonId}') a));`);
  const access = resolveSubscriptionAccess({
    subscription: { status: row.status!, trialEndsAt: row.trialEndsAt, currentPeriodEndsAt: row.currentPeriodEndsAt, billingProvider: row.billingProvider,
      billingEnvironment: row.billingEnvironment, providerCustomerId: row.providerCustomerId, providerSubscriptionId: row.providerSubscriptionId },
    plan: plans[row.plan!], trustedEnvironment: "test", now: new Date(),
  });
  assert.deepEqual({ full: access.hasActiveAccess, reason: access.accessReason, slug: access.effectivePlanCode }, db);
  return db;
}

const eligibility = (s: Salon) => async () => {
  const { data, error } = await rpc("resolve_billing_resubscribe_eligibility_v1", { p_salon_id: s.salonId, p_actor_profile_id: s.owner });
  if (error) throw new Error(error);
  const row = (data as { eligible: boolean; reason: string | null }[])[0];
  return { eligible: row.eligible, reason: row.reason };
};

test("setup catalogue", async () => {
  await sql(`
    insert into private.billing_runtime_config(singleton,environment) values(true,'test') on conflict(singleton) do update set environment='test';
    insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_product_id,provider_variant_id,provider_store_id,is_active)
    select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'1451030',case p.slug when 'starter' then '2264918' else '2264940' end,'501229',true
    from public.plans p where p.slug in ('starter','pro')
    on conflict(provider,environment,plan_id,billing_interval,currency) do update set provider_product_id=excluded.provider_product_id,
      provider_variant_id=excluded.provider_variant_id,provider_store_id=excluded.provider_store_id,is_active=true;
    select 1;`);
});

test("flag off: the expired owner gets the existing refusal and the provider is never called", async () => {
  const s = await expiredSalon();
  const { calls, provider } = mockProvider();
  assert.equal(await code(checkout(s, "pro", false, provider)), "BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED");
  assert.equal(calls.length, 0);
  assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription: { status: "expired", billing_provider: "lemonsqueezy", provider_subscription_id: s.pid, current_period_ends_at: null }, enabled: false, now: new Date() },
    { eligibility: eligibility(s) }), { state: "disabled", reason: null });
});

test("eligible expired owner: one provider checkout, no access before activation, canonical access after", async () => {
  const s = await expiredSalon(2);
  const overview = await resolveResubscribeOverview({ isOwner: true, subscription: { status: "expired", billing_provider: "lemonsqueezy", provider_subscription_id: s.pid, current_period_ends_at: null }, enabled: true, now: new Date() },
    { eligibility: eligibility(s) });
  assert.deepEqual(overview, { state: "eligible", reason: null });
  const { calls, provider } = mockProvider();
  const result = await checkout(s, "pro", true, provider);
  assert.equal(result.responseStatus, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].planCode, "pro");
  assert.equal(calls[0].providerVariantId, "2264940");
  // the intent is bound to the terminal generation; nothing is granted on redirect
  assert.equal(await sql(`select resubscribe_from_provider_subscription_id||':'||resubscribe_from_generation from public.billing_checkout_sessions where id='${calls[0].checkoutSessionId}';`), `${s.pid}:1`);
  assert.deepEqual(await parity(s), { full: false, reason: "expired", slug: "starter" });
  assert.equal(await activate(s, "940001", "950001"), "processed");
  assert.deepEqual(await parity(s), { full: true, reason: "active_period", slug: "pro" });
  // the C2 overview never shows the superseded identity's history as the current change
  await sql(`insert into public.billing_subscription_plan_changes(subscription_id,salon_id,environment,provider_subscription_id,provider_customer_id,
      provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,from_provider_variant_id,target_provider_product_id,
      target_provider_variant_id,baseline_period_end,baseline_provider_updated_at,requested_by_profile_id,requested_at,status,resolved_at)
    select s.id,s.salon_id,'test','${s.pid}','${s.customer}','501229','upgrade',(select id from public.plans where slug='starter'),
      (select id from public.plans where slug='pro'),'1451030','2264918','1451030','2264940',now()-interval '5 days',now()-interval '35 days',
      '${s.owner}',now()-interval '10 days','abandoned',now()-interval '1 hour' from public.subscriptions s where s.salon_id='${s.salonId}';
    select 1;`);
  const client: PlanChangeDatabaseClient = {
    rpc: async () => { throw new Error("not used"); },
    from: (table) => ({
      select: (columns) => {
        const where: string[] = []; let order = "";
        const builder = {
          eq(column: string, value: unknown) { where.push(`${column} = ${lit(value)}`); return builder; },
          order(column: string, options: { ascending: boolean }) { order = ` order by ${column} ${options.ascending ? "asc" : "desc"}`; return builder; },
          limit: async (count: number) => ({ data: JSON.parse(await sql(`select coalesce(json_agg(t), '[]'::json) from (select ${columns} from public.${table} where ${where.join(" and ")}${order} limit ${count}) t;`)), error: null }),
        };
        return builder;
      },
    }),
  };
  assert.equal(await new SupabaseBillingPlanChangeRepository(client).latestChange(s.salonId), null);
});

test("Starter with surplus employees is refused before any provider call; read-only deactivation then allows it", async () => {
  const s = await expiredSalon(4);
  const { calls, provider } = mockProvider();
  assert.equal(await code(checkout(s, "starter", true, provider)), "EMPLOYEE_OVER_TARGET_LIMIT");
  assert.equal(calls.length, 0);
  assert.equal(await sql(`select count(*) from public.billing_checkout_sessions where salon_id='${s.salonId}';`), "0");
  await sql(`update public.employees set is_active=false where id=(select id from public.employees where salon_id='${s.salonId}' and is_active limit 1); select 1;`);
  assert.equal(await code(checkout(s, "starter", true, provider)), "ok");
  assert.equal(calls.length, 1);
});

test("override and unconfirmed terminal state are explained and refused without a provider call", async () => {
  const s = await expiredSalon();
  await sql(`insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at)
    select '${s.salonId}',id,'internal','e1 ts pilot',now()-interval '1 day' from public.plans where slug='pro'; select 1;`);
  const { calls, provider } = mockProvider();
  assert.equal(await code(checkout(s, "pro", true, provider)), "BILLING_OVERRIDE_ACTIVE");
  const t = await expiredSalon();
  await sql(`update public.subscriptions set status='cancelled',provider_last_webhook_event_id=null where salon_id='${t.salonId}'; select 1;`);
  assert.deepEqual(await resolveResubscribeOverview({ isOwner: true, subscription: { status: "cancelled", billing_provider: "lemonsqueezy", provider_subscription_id: t.pid, current_period_ends_at: new Date(Date.now() - 3600_000).toISOString() }, enabled: true, now: new Date() },
    { eligibility: eligibility(t) }), { state: "blocked", reason: "terminal_state_unconfirmed" });
  assert.equal(await code(checkout(t, "pro", true, provider)), "BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED");
  assert.equal(calls.length, 0);
});

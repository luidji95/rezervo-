import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { createDisposableSupabasePostgres } from "../../../../scripts/lib/disposable-supabase-postgres.mjs";
import { refreshPlanChange, requestPlanChange, toProviderEvidence, type BillingPlanChangeRepository } from "./billingPlanChangeCore.ts";
import { parsePlanChangeSnapshot, type BillingPlanChangeProvider, type PlanChangePatchResult } from "./lemonSqueezyPlanChangeProvider.ts";
import { subscriptionPayload } from "./planChangeTestFixtures.ts";
import { SupabaseBillingPlanChangeRepository, type PlanChangeDatabaseClient } from "./supabaseBillingPlanChangeRepositoryCore.ts";

// TS core + the real Supabase repository against the real C2 RPCs on a disposable PostgreSQL
// container (never the persistent local database). The provider is a mock that counts PATCHes.
const postgres = createDisposableSupabasePostgres("rezervo-c2-endpoint-db");
await postgres.initialize();
test.after(() => postgres.cleanup());

function psql(sql: string): Promise<{ ok: true; json: unknown } | { ok: false; code: string; message: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["exec", "-i", postgres.container, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      if (code === 0) { resolve({ ok: true, json: JSON.parse(out.trim() || "null") }); return; }
      const match = /ERROR:\s+([0-9A-Z]{5}):\s+(.+)/.exec(err);
      resolve({ ok: false, code: match?.[1] ?? "XX000", message: (match?.[2] ?? err).trim() });
    });
    child.stdin.end(sql);
  });
}
const lit = (value: unknown) => value === null || value === undefined ? "null"
  : typeof value === "boolean" || typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;

/** supabase-js-compatible surface backed by psql: real RPC semantics, real errors. */
const client: PlanChangeDatabaseClient = {
  rpc: async (name, args) => {
    const call = Object.entries(args).map(([key, value]) => `${key} => ${lit(value)}`).join(", ");
    const result = await psql(`select coalesce(json_agg(r), '[]'::json) from public.${name}(${call}) r;`);
    return result.ok ? { data: result.json, error: null } : { data: null, error: { code: result.code, message: result.message } };
  },
  from: (table) => ({
    select: (columns) => {
      const where: string[] = []; let order = "";
      const builder = {
        eq(column: string, value: unknown) { where.push(`${column} = ${lit(value)}`); return builder; },
        order(column: string, options: { ascending: boolean }) { order = ` order by ${column} ${options.ascending ? "asc" : "desc"}`; return builder; },
        limit: async (count: number) => {
          const result = await psql(`select coalesce(json_agg(t), '[]'::json) from (select ${columns} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${order} limit ${count}) t;`);
          return result.ok ? { data: result.json, error: null } : { data: null, error: { code: result.code, message: result.message } };
        },
      };
      return builder;
    },
  }),
};
const repository = new SupabaseBillingPlanChangeRepository(client);
const one = async (sql: string) => { const r = await psql(sql); if (!r.ok) throw new Error(r.message); return r.json; };

const NOW = new Date("2027-03-01T00:00:00.000Z");
let counter = 0;
async function salon(plan: "starter" | "pro" = "starter") {
  counter += 1;
  const n = String(counter).padStart(2, "0");
  const owner = `c2e00000-0000-4000-8000-0000000000${n}`;
  const salonId = `c2e10000-0000-4000-8000-0000000000${n}`;
  const pid = String(2618300 + counter);
  const customer = String(8000 + counter);
  await one(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','c2e-${n}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values('${salonId}','${owner}','C2E ${n}','c2e-${n}');
    update public.subscriptions set plan_id=(select id from public.plans where slug='${plan}'),status='active',billing_provider='lemonsqueezy',
      billing_environment='test',provider_customer_id='${customer}',provider_subscription_id='${pid}',trial_starts_at=null,trial_ends_at=null,
      current_period_starts_at='2027-02-28T00:00:00Z',current_period_ends_at='2027-03-31T00:00:00Z',provider_state_updated_at='2027-02-28T00:00:30Z'
    where salon_id='${salonId}';
    select 'null'::json;`);
  return { owner, salonId, pid, customer, variant: plan === "starter" ? 2264918 : 2264940 };
}
type Salon = Awaited<ReturnType<typeof salon>>;

function mockProvider(s: Salon, options: { readVariant?: number; readUpdatedAt?: string; readDelayMs?: number; patch?: () => Promise<PlanChangePatchResult> } = {}) {
  const calls = { read: 0, patch: 0 };
  const snapshot = (variant: number, updatedAt: string) => parsePlanChangeSnapshot(subscriptionPayload({ variant_id: variant, customer_id: Number(s.customer), updated_at: updatedAt }, s.pid));
  const provider: BillingPlanChangeProvider = {
    readSubscription: async () => {
      calls.read += 1;
      if (options.readDelayMs) await new Promise((r) => setTimeout(r, options.readDelayMs));
      return { kind: "snapshot", snapshot: snapshot(options.readVariant ?? s.variant, options.readUpdatedAt ?? "2027-02-28T00:00:30.000000Z") };
    },
    patchVariant: async (_id, variant) => {
      calls.patch += 1;
      return options.patch ? options.patch() : { kind: "accepted", snapshot: snapshot(Number(variant), "2027-03-01T00:00:05.000000Z") };
    },
  };
  return { provider, calls, snapshot };
}
const deps = (provider: BillingPlanChangeProvider, repo: BillingPlanChangeRepository = repository) => ({ repository: repo, provider, environment: "test" as const, storeId: "501229", now: () => NOW });
const dbChange = async (s: Salon) => (await one(`select json_build_object('status',status,'attempts',attempt_count,'confirmed',confirmed_provider_updated_at,'rows',(select count(*) from public.billing_subscription_plan_changes where salon_id='${s.salonId}')) from public.billing_subscription_plan_changes where salon_id='${s.salonId}' order by created_at desc limit 1;`)) as { status: string; attempts: number; confirmed: string | null; rows: number } | null;

test("setup", async () => {
  await one(`
    insert into private.billing_runtime_config(singleton,environment) values(true,'test') on conflict(singleton) do update set environment='test';
    insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_product_id,provider_variant_id,provider_store_id,is_active)
    select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'1451030',case p.slug when 'starter' then '2264918' else '2264940' end,'501229',true
    from public.plans p where p.slug in ('starter','pro')
    on conflict(provider,environment,plan_id,billing_interval,currency) do update set provider_product_id=excluded.provider_product_id,
      provider_variant_id=excluded.provider_variant_id,provider_store_id=excluded.provider_store_id,is_active=true;
    select 'null'::json;`);
});

test("happy path over the real RPCs: one PATCH, E1 from the accepted response, scheduled not completed", async () => {
  for (const [plan, target] of [["starter", "pro"], ["pro", "starter"]] as const) {
    const s = await salon(plan);
    const { provider, calls } = mockProvider(s);
    const result = await requestPlanChange({ userId: s.owner, targetPlan: target }, deps(provider));
    assert.equal(result.outcome, "requested");
    assert.equal(result.change?.status, "confirmed");
    assert.equal(result.change?.targetPlan, target);
    assert.equal(calls.patch, 1);
    assert.deepEqual(await one(`select json_build_object('plan',p.slug,'end',s.current_period_ends_at) from public.subscriptions s join public.plans p on p.id=s.plan_id where s.salon_id='${s.salonId}';`),
      { plan, end: "2027-03-31T00:00:00+00:00" }, "plan and paid period unchanged until the renewal evidence");
  }
});

test("concurrent requests for one salon dispatch at most one PATCH", async () => {
  const s = await salon();
  const a = mockProvider(s, { readDelayMs: 300 });
  const b = mockProvider(s, { readDelayMs: 300 });
  const results = await Promise.all([
    requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(a.provider)),
    requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(b.provider)),
  ]);
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["already_pending", "requested"]);
  assert.equal(a.calls.patch + b.calls.patch, 1);
  assert.equal((await dbChange(s))?.rows, 1);
  // repeating the same request later never re-dispatches
  const c = mockProvider(s);
  assert.equal((await requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(c.provider))).outcome, "already_pending");
  assert.equal(c.calls.read + c.calls.patch, 0);
});

test("process stopped after the durable intent and before the PATCH: blocked, never re-dispatched, refresh does not PATCH", async () => {
  const s = await salon();
  const { snapshot } = mockProvider(s);
  const prepared = await repository.prepare({ salonId: s.salonId, actorProfileId: s.owner, targetPlanId: String(await repository.findActivePlanId("pro")), now: NOW.toISOString() });
  await repository.request({
    salonId: s.salonId, actorProfileId: s.owner, targetPlanId: String(await repository.findActivePlanId("pro")), stateToken: String(prepared.stateToken),
    evidence: toProviderEvidence(snapshot(2264918, "2027-02-28T00:00:30.000000Z")),
    checkedAt: NOW.toISOString(), now: NOW.toISOString(),
  });
  const retry = mockProvider(s);
  assert.equal((await requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(retry.provider))).outcome, "already_pending");
  const refresh = mockProvider(s); // provider still shows the previous variant
  const refreshed = await refreshPlanChange({ userId: s.owner }, deps(refresh.provider));
  assert.equal(refreshed.change?.status, "requested", "an old-variant read does not prove the change will never apply");
  assert.equal(retry.calls.patch + refresh.calls.patch, 0);
});

test("accepted PATCH whose DB record response is lost: idempotent replay, or unknown, never a second PATCH", async () => {
  // first record commits but its response is lost; the replay of the same result succeeds
  const s = await salon();
  let attempts = 0;
  const lossy: BillingPlanChangeRepository = Object.assign(Object.create(repository), {
    record: async (input: Parameters<BillingPlanChangeRepository["record"]>[0]) => {
      attempts += 1;
      await repository.record(input);
      if (attempts === 1) throw new Error("response lost after commit");
    },
  });
  const one1 = mockProvider(s);
  const replayed = await requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(one1.provider, lossy));
  assert.equal(replayed.outcome, "requested");
  assert.deepEqual([attempts, one1.calls.patch, (await dbChange(s))?.status, (await dbChange(s))?.attempts], [2, 1, "confirmed", 1]);

  // the database never received the result: outcome unknown, change stays requested (not not_applied)
  const t = await salon();
  const down: BillingPlanChangeRepository = Object.assign(Object.create(repository), { record: async () => { throw new Error("database unavailable"); } });
  const two = mockProvider(t);
  const unknown = await requestPlanChange({ userId: t.owner, targetPlan: "pro" }, deps(two.provider, down));
  assert.equal(unknown.outcome, "status_unknown");
  assert.equal((await dbChange(t))?.status, "requested");
  // a later status check observes the target and confirms, still without any PATCH
  const refresh = mockProvider(t, { readVariant: 2264940, readUpdatedAt: "2027-03-01T00:00:05.000000Z" });
  assert.equal((await refreshPlanChange({ userId: t.owner }, deps(refresh.provider))).change?.status, "confirmed");
  assert.equal(two.calls.patch + refresh.calls.patch, 1);
});

test("timeout is ambiguous -> unknown; refresh resolves from provider evidence without a PATCH", async () => {
  const s = await salon();
  const { provider, calls } = mockProvider(s, { patch: async () => ({ kind: "ambiguous" }) });
  const result = await requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(provider));
  assert.equal(result.change?.status, "unknown");
  assert.equal((await requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(mockProvider(s).provider))).outcome, "already_pending");
  const refresh = mockProvider(s, { readVariant: 2264940, readUpdatedAt: "2027-03-01T00:00:07.000000Z" });
  assert.equal((await refreshPlanChange({ userId: s.owner }, deps(refresh.provider))).change?.status, "confirmed");
  assert.equal(calls.patch + refresh.calls.patch, 1);
});

test("a webhook confirmation committed before the HTTP record is not overwritten by the older PATCH response", async () => {
  const s = await salon();
  const { provider, calls, snapshot } = mockProvider(s, {
    patch: async () => {
      // signed subscription_updated (E1, provider version 00:00:10) processed before our record
      await one(`select json_agg(r) from public.ingest_billing_webhook_event_v2('lemonsqueezy','test','subscription_updated','subscriptions','${s.pid}',
        encode(digest('c2e-webhook-${s.pid}','sha256'),'hex'),encode(digest('c2e-webhook-sem-${s.pid}','sha256'),'hex'),'received',null,true,
        gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),'${s.pid}','order-${s.pid}','${s.customer}','1451030','2264940','active',
        '2027-02-28T00:00:00Z','2027-03-01T00:00:10Z',true,'ready',null,'501229','2027-03-31T00:00:00Z',null,false,null,null,null) e
        cross join lateral public.process_billing_subscription_updated_v2(e.event_id,'2027-03-01T00:00:20Z') r;`);
      return { kind: "accepted", snapshot: snapshot(2264940, "2027-03-01T00:00:05.000000Z") };
    },
  });
  const result = await requestPlanChange({ userId: s.owner, targetPlan: "pro" }, deps(provider));
  assert.equal(result.change?.status, "confirmed");
  assert.equal(calls.patch, 1);
  assert.equal((await dbChange(s))?.confirmed, "2027-03-01T00:00:10+00:00", "newest provider evidence kept");
});

test("database refusals (48 h, capacity, other tenant) send nothing", async () => {
  const close = await salon();
  await one(`update public.subscriptions set current_period_ends_at='2027-03-03T00:00:00Z' where salon_id='${close.salonId}'; select 'null'::json;`);
  const p1 = mockProvider(close);
  await assert.rejects(requestPlanChange({ userId: close.owner, targetPlan: "pro" }, deps(p1.provider)), /RENEWAL_TOO_CLOSE/);

  const crowded = await salon("pro");
  await one(`alter table public.employees disable trigger user; insert into public.employees(salon_id,full_name) select '${crowded.salonId}','E'||g from generate_series(1,4) g; alter table public.employees enable trigger user; select 'null'::json;`);
  const p2 = mockProvider(crowded);
  await assert.rejects(requestPlanChange({ userId: crowded.owner, targetPlan: "starter" }, deps(p2.provider)), /EMPLOYEES_OVER_TARGET/);

  const stranger = await salon();
  const other = await salon();
  const p3 = mockProvider(other);
  // The tenant comes only from the verified user; a provider answer for another tenant's
  // subscription is refused before any intent or PATCH.
  await assert.rejects(requestPlanChange({ userId: stranger.owner, targetPlan: "pro" }, deps(p3.provider)), /STATE_CHANGED/);
  assert.equal(await dbChange(other), null, "other tenant untouched");
  assert.equal(await dbChange(stranger), null, "no intent for the mismatched read");
  assert.equal(p1.calls.read + p1.calls.patch + p2.calls.read + p2.calls.patch + p3.calls.patch, 0);
  // a user who owns no salon (manager/employee) is forbidden
  const manager = "c2e20000-0000-4000-8000-000000000001";
  await one(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${manager}','c2e-manager@example.invalid','{}','{}');
    insert into public.salon_members(salon_id,profile_id,role,status) values('${other.salonId}','${manager}','manager','active'); select 'null'::json;`);
  await assert.rejects(requestPlanChange({ userId: manager, targetPlan: "pro" }, deps(p3.provider)), /FORBIDDEN/);
  assert.equal(p3.calls.patch, 0);
});

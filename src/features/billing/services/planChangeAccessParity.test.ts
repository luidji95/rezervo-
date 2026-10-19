import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubscriptionAccess, type SubscriptionAccessPlan } from "./subscriptionAccess.ts";

import { createDisposableSupabasePostgres } from "../../../../scripts/lib/disposable-supabase-postgres.mjs";

// C2 DB/TS access parity over the real capped subscription row, on a disposable PostgreSQL
// container only. TS reads the same subscription row the database resolver reads, so a pending
// plan change must never yield wider TS access than resolve_salon_access_v1.
const postgres = createDisposableSupabasePostgres("rezervo-c2-access-parity");
await postgres.initialize();
test.after(() => postgres.cleanup());

const T0 = "2027-01-01T00:00:00Z";
const BASELINE = "2027-01-31T00:00:00Z";
const capabilities = { canUseStatistics: true, canUseAiReceptionist: false, canUseWhatsApp: false, canUseInstagram: false, canUseMarketing: false, canUseSmsReminders: true, maxMonthlyBookings: null, maxAiMessages: 0, maxMonthlyReminders: null };
const plans: Record<string, SubscriptionAccessPlan> = {
  starter: { ...capabilities, code: "starter", name: "Starter", isActive: true, maxEmployees: 3 },
  pro: { ...capabilities, code: "pro", name: "Pro", isActive: true, maxEmployees: 10 },
};

const salon = "c2a00000-0000-4000-8000-000000000001";
const owner = "c2a00000-0000-4000-8000-000000000002";

async function rowAndDbAccess(at: string) {
  const json = await postgres.sql(`select json_build_object(
      'row', (select json_build_object('status',s.status,'trialEndsAt',s.trial_ends_at,'currentPeriodEndsAt',s.current_period_ends_at,
        'billingProvider',s.billing_provider,'billingEnvironment',s.billing_environment,'providerCustomerId',s.provider_customer_id,
        'providerSubscriptionId',s.provider_subscription_id,'plan',p.slug)
        from public.subscriptions s join public.plans p on p.id=s.plan_id where s.salon_id='${salon}'),
      'db', (select json_build_object('full',a.has_full_access,'reason',a.access_reason,'slug',a.effective_plan_slug)
        from public.resolve_salon_access_v1('${salon}','${at}') a));`, "read");
  return JSON.parse(json);
}

function tsAccess(row: Record<string, string | null>, at: string) {
  const access = resolveSubscriptionAccess({
    subscription: {
      status: row.status!, trialEndsAt: row.trialEndsAt, currentPeriodEndsAt: row.currentPeriodEndsAt,
      billingProvider: row.billingProvider, billingEnvironment: row.billingEnvironment,
      providerCustomerId: row.providerCustomerId, providerSubscriptionId: row.providerSubscriptionId,
    },
    plan: plans[row.plan!],
    trustedEnvironment: "test",
    now: new Date(at),
  });
  return { full: access.hasActiveAccess, reason: access.accessReason, slug: access.effectivePlanCode };
}

async function assertParity(at: string, expected: { full: boolean; slug: string }) {
  const { row, db } = await rowAndDbAccess(at);
  assert.deepEqual(tsAccess(row, at), db, `parity at ${at}`);
  assert.equal(db.full, expected.full, `access at ${at}`);
  assert.equal(db.slug, expected.slug, `plan at ${at}`);
}

const event = (suffix: string, variant: string, updated: string, renews: string) => `
  select r.outcome from public.ingest_billing_webhook_event_v2('lemonsqueezy','test','subscription_updated','subscriptions','910001',
    encode(digest('parity-${suffix}','sha256'),'hex'),encode(digest('parity-sem-${suffix}','sha256'),'hex'),'received',null,true,
    gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),'910001','order-910001','910002','1451030','${variant}','active',
    '2026-12-31T00:00:00Z','${updated}',true,'ready',null,'501229','${renews}',null,false,null,null,null) e
  cross join lateral public.process_billing_subscription_updated_v2(e.event_id,'${updated}'::timestamptz + interval '1 minute') r;`;

test("pending plan change: TS access equals DB access over the capped row in every phase", async () => {
  await postgres.sql(`
    insert into private.billing_runtime_config(singleton,environment) values(true,'test') on conflict(singleton) do update set environment='test';
    insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_product_id,provider_variant_id,provider_store_id,is_active)
    select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'1451030',case p.slug when 'starter' then '2264918' else '2264940' end,'501229',true
    from public.plans p where p.slug in ('starter','pro')
    on conflict(provider,environment,plan_id,billing_interval,currency) do update set provider_product_id=excluded.provider_product_id,
      provider_variant_id=excluded.provider_variant_id,provider_store_id=excluded.provider_store_id,is_active=true;
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','c2-parity@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values('${salon}','${owner}','C2 parity','c2-parity');
    update public.subscriptions set plan_id=(select id from public.plans where slug='starter'),status='active',billing_provider='lemonsqueezy',
      billing_environment='test',provider_customer_id='910002',provider_subscription_id='910001',trial_starts_at=null,trial_ends_at=null,
      current_period_starts_at='2026-12-31T00:00:00Z',current_period_ends_at='${BASELINE}',provider_state_updated_at='2026-12-31T00:00:30Z'
    where salon_id='${salon}';
    select plan_change_id from public.request_billing_plan_change_v1('${salon}','${owner}',(select id from public.plans where slug='pro'),
      (select private.billing_subscription_state_fingerprint_v1(s) from public.subscriptions s where s.salon_id='${salon}'),
      '910001','910002','501229',true,'1451030','2264918','active',false,null,null,'${BASELINE}',null,'2026-12-31T00:00:30Z',
      '${T0}'::timestamptz - interval '1 minute','${T0}');`, "fixture");
  await assertParity("2027-01-10T00:00:00Z", { full: true, slug: "starter" });

  // E1 (target confirmed before the boundary), then the provider renews without payment evidence
  await postgres.sql(event("e1", "2264940", "2027-01-01T00:00:05Z", BASELINE), "e1");
  await postgres.sql(event("e2", "2264940", "2027-01-31T00:01:00Z", "2027-02-28T00:00:00Z"), "e2");
  await assertParity("2027-01-30T23:59:00Z", { full: true, slug: "starter" });
  await assertParity("2027-01-31T00:05:00Z", { full: false, slug: "starter" });

  // E3: paid renewal invoice completes; access follows the renewed target period
  await postgres.sql(`select outcome from public.ingest_billing_subscription_invoice_evidence_v1('lemonsqueezy','test','subscription_payment_success',
    'subscription-invoices','910003',encode(digest('parity-inv','sha256'),'hex'),encode(digest('parity-inv-sem','sha256'),'hex'),true,
    '910003','910001','910002','501229','renewal','paid','2027-01-31T00:00:10Z','2027-01-31T00:00:40Z','2027-01-31T00:06:00Z');`, "e3");
  await assertParity("2027-01-31T00:07:00Z", { full: true, slug: "pro" });
  await assertParity("2027-02-28T00:01:00Z", { full: false, slug: "pro" });
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { resolveSubscriptionAccess, type SubscriptionAccessPlan } from "../../billing/services/subscriptionAccess.ts";
import { resolveEffectiveAccess } from "../../billing/services/billingOverrideAccess.ts";

import { createDisposableSupabasePostgres } from "../../../../scripts/lib/disposable-supabase-postgres.mjs";

// Runs on a disposable PostgreSQL container by default. An explicit BASELINE_DB_CONTAINER may point at
// another disposable container; the persistent local Supabase database is refused.
const explicitContainer = process.env.BASELINE_DB_CONTAINER;
if (explicitContainer === "supabase_db_rezervo") throw new Error("Refusing to run the capacity parity test on the persistent local database.");
const disposable = explicitContainer ? null : createDisposableSupabasePostgres("rezervo-capacity-parity");
if (disposable) await disposable.initialize();
test.after(() => disposable?.cleanup());
const container: string = explicitContainer ?? disposable!.container;
const database = process.env.BASELINE_DB_NAME ?? "postgres";
const owner = (suffix: string) => `d1000000-0000-4000-8000-0000000000${suffix}`;
const now = new Date("2026-07-27T12:00:00.000Z");
const salon = (suffix: string) => `d2000000-0000-4000-8000-0000000000${suffix}`;

function psql(sql: string) {
  return execFileSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-Atc", sql], { encoding: "utf8" }).trim();
}

const capabilities = { canUseStatistics: true, canUseAiReceptionist: false, canUseWhatsApp: false, canUseInstagram: false, canUseMarketing: false, canUseSmsReminders: true, maxMonthlyBookings: null, maxAiMessages: 0, maxMonthlyReminders: null };
function plan(code: "pro" | "premium", maxEmployees: number, isActive = true): SubscriptionAccessPlan {
  return { ...capabilities, code, name: code, isActive, maxEmployees };
}

test("database employee capacity lifecycle matches the TypeScript access contract", () => {
  try {
    psql(`delete from auth.users where id in ('${owner("01")}','${owner("02")}','${owner("03")}','${owner("04")}','${owner("05")}','${owner("06")}'); insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('${owner("01")}','capacity-parity-1@example.invalid','{}','{}'),('${owner("02")}','capacity-parity-2@example.invalid','{}','{}'),('${owner("03")}','capacity-parity-3@example.invalid','{}','{}'),('${owner("04")}','capacity-parity-4@example.invalid','{}','{}'),('${owner("05")}','capacity-parity-5@example.invalid','{}','{}'),('${owner("06")}','capacity-parity-6@example.invalid','{}','{}'); insert into public.salons(id,owner_id,name,slug) values ('${salon("01")}','${owner("01")}','Parity Trial','parity-trial'),('${salon("02")}','${owner("02")}','Parity Expired','parity-expired'),('${salon("03")}','${owner("03")}','Parity Legacy','parity-legacy'),('${salon("04")}','${owner("04")}','Parity Past Due','parity-past-due'),('${salon("05")}','${owner("05")}','Parity Cancelled','parity-cancelled'),('${salon("06")}','${owner("06")}','Parity Override','parity-override'); update public.subscriptions set status='trialing',trial_ends_at='2026-07-28T12:00:00Z' where salon_id='${salon("01")}'; update public.subscriptions set status='trialing',trial_ends_at='2026-07-27T12:00:00Z' where salon_id='${salon("02")}'; update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='capacity-customer-03',provider_subscription_id='capacity-subscription-03',current_period_starts_at='2026-07-01T12:00:00Z',current_period_ends_at='2026-08-27T12:00:00Z',provider_state_updated_at='2026-07-01T12:00:00Z' where salon_id='${salon("03")}'; update public.subscriptions set status='past_due',trial_starts_at=null,trial_ends_at=null,billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='capacity-customer-04',provider_subscription_id='capacity-subscription-04',current_period_starts_at='2026-07-01T12:00:00Z',current_period_ends_at='2026-08-27T12:00:00Z',provider_state_updated_at='2026-07-01T12:00:00Z' where salon_id='${salon("04")}'; update public.subscriptions set status='cancelled',trial_starts_at=null,trial_ends_at=null,billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='capacity-customer-05',provider_subscription_id='capacity-subscription-05',current_period_starts_at='2026-07-01T12:00:00Z',current_period_ends_at='2026-07-28T12:00:00Z',provider_state_updated_at='2026-07-01T12:00:00Z',cancel_at_period_end=true,cancelled_at='2026-07-20T12:00:00Z' where salon_id='${salon("05")}'; update public.subscriptions set status='expired' where salon_id='${salon("06")}'; insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at) select '${salon("06")}',id,'internal','parity test','2026-07-26T12:00:00Z' from public.plans where slug='premium';`);
    psql("insert into private.billing_runtime_config(singleton,environment) values(true,'test') on conflict(singleton) do nothing;");
    const db = JSON.parse(psql(`select json_agg(x order by x.salon_id) from (select c.*, s.id salon_id from public.salons s cross join lateral public.resolve_employee_capacity_v1(s.id,'2026-07-27T12:00:00Z') c where s.id in ('${salon("01")}','${salon("02")}','${salon("03")}','${salon("04")}','${salon("05")}','${salon("06")}')) x`));
    const pro = plan("pro", 10);
    const subscription = (status: string, trialEndsAt: string | null, currentPeriodEndsAt: string | null) => resolveSubscriptionAccess({
      subscription: {
        status, trialEndsAt, currentPeriodEndsAt,
        billingProvider: status === "trialing" ? null : "lemonsqueezy",
        billingEnvironment: status === "trialing" ? null : "test",
        providerCustomerId: status === "trialing" ? null : "capacity-customer",
        providerSubscriptionId: status === "trialing" ? null : "capacity-subscription",
      },
      plan: pro,
      trustedEnvironment: "test",
      now,
    });
    const expected = [
      subscription("trialing", "2026-07-28T12:00:00Z", null),
      subscription("trialing", "2026-07-27T12:00:00Z", null),
      subscription("active", null, "2026-08-27T12:00:00Z"),
      subscription("past_due", null, "2026-08-27T12:00:00Z"),
      subscription("cancelled", null, "2026-07-28T12:00:00Z"),
      resolveEffectiveAccess({ subscriptionAccess: subscription("expired", null, null), billingOverride: { enabled: true, overrideType: "internal", startsAt: "2026-07-26T12:00:00Z", endsAt: null }, overridePlan: plan("premium", 25, false), trustedEnvironment: "test", now }),
    ];
    assert.deepEqual(db.map((row: Record<string, unknown>) => ({ full: row.has_full_access, reason: row.access_reason, slug: row.effective_plan_slug, max: row.max_employees })), expected.map((item) => ({ full: item.hasActiveAccess, reason: item.accessReason, slug: item.effectivePlanCode, max: item.planCapabilities.maxEmployees })));
    // the effective (v2) capacity equals the plan limit when no checkout is pending
    const v2 = JSON.parse(psql(`select json_agg(x order by x.salon_id) from (select c.plan_max_employees, c.max_employees, c.capacity_reason, s.id salon_id from public.salons s cross join lateral public.resolve_employee_capacity_v2(s.id,'2026-07-27T12:00:00Z') c where s.id in ('${salon("01")}','${salon("02")}','${salon("03")}','${salon("04")}','${salon("05")}','${salon("06")}')) x`));
    assert.deepEqual(v2.map((row: Record<string, unknown>) => [row.plan_max_employees, row.max_employees, row.capacity_reason === "pending_checkout"]), db.map((row: Record<string, unknown>) => [row.max_employees, row.max_employees, false]));
  } finally {
    psql(`delete from auth.users where id in ('${owner("01")}','${owner("02")}','${owner("03")}','${owner("04")}','${owner("05")}','${owner("06")}')`);
  }
});

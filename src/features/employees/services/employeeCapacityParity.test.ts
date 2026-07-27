import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { resolveSubscriptionAccess, type SubscriptionAccessPlan } from "../../billing/services/subscriptionAccess.ts";
import { resolveEffectiveAccess } from "../../billing/services/billingOverrideAccess.ts";

const container = process.env.BASELINE_DB_CONTAINER ?? "supabase_db_rezervo";
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
    psql(`delete from auth.users where id in ('${owner("01")}','${owner("02")}','${owner("03")}','${owner("04")}','${owner("05")}','${owner("06")}'); insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('${owner("01")}','capacity-parity-1@example.invalid','{}','{}'),('${owner("02")}','capacity-parity-2@example.invalid','{}','{}'),('${owner("03")}','capacity-parity-3@example.invalid','{}','{}'),('${owner("04")}','capacity-parity-4@example.invalid','{}','{}'),('${owner("05")}','capacity-parity-5@example.invalid','{}','{}'),('${owner("06")}','capacity-parity-6@example.invalid','{}','{}'); insert into public.salons(id,owner_id,name,slug) values ('${salon("01")}','${owner("01")}','Parity Trial','parity-trial'),('${salon("02")}','${owner("02")}','Parity Expired','parity-expired'),('${salon("03")}','${owner("03")}','Parity Legacy','parity-legacy'),('${salon("04")}','${owner("04")}','Parity Past Due','parity-past-due'),('${salon("05")}','${owner("05")}','Parity Cancelled','parity-cancelled'),('${salon("06")}','${owner("06")}','Parity Override','parity-override'); update public.subscriptions set status='trialing',trial_ends_at='2026-07-28T12:00:00Z' where salon_id='${salon("01")}'; update public.subscriptions set status='trialing',trial_ends_at='2026-07-27T12:00:00Z' where salon_id='${salon("02")}'; update public.subscriptions set status='active',trial_ends_at=null,current_period_ends_at=null where salon_id='${salon("03")}'; update public.subscriptions set status='past_due' where salon_id='${salon("04")}'; update public.subscriptions set status='cancelled',current_period_ends_at='2026-07-28T12:00:00Z' where salon_id='${salon("05")}'; update public.subscriptions set status='expired' where salon_id='${salon("06")}'; insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at) select '${salon("06")}',id,'internal','parity test','2026-07-26T12:00:00Z' from public.plans where slug='premium';`);
    const db = JSON.parse(psql(`select json_agg(x order by x.salon_id) from (select c.*, s.id salon_id from public.salons s cross join lateral public.resolve_employee_capacity_v1(s.id,'2026-07-27T12:00:00Z') c where s.id in ('${salon("01")}','${salon("02")}','${salon("03")}','${salon("04")}','${salon("05")}','${salon("06")}')) x`));
    const pro = plan("pro", 10);
    const subscription = (status: string, trialEndsAt: string | null, currentPeriodEndsAt: string | null) => resolveSubscriptionAccess({ subscription: { status, trialEndsAt, currentPeriodEndsAt }, plan: pro, now });
    const expected = [
      subscription("trialing", "2026-07-28T12:00:00Z", null),
      subscription("trialing", "2026-07-27T12:00:00Z", null),
      subscription("active", null, null),
      subscription("past_due", null, null),
      subscription("cancelled", null, "2026-07-28T12:00:00Z"),
      resolveEffectiveAccess({ subscriptionAccess: subscription("expired", null, null), billingOverride: { enabled: true, overrideType: "internal", startsAt: "2026-07-26T12:00:00Z", endsAt: null }, overridePlan: plan("premium", 25, false), now }),
    ];
    assert.deepEqual(db.map((row: Record<string, unknown>) => ({ full: row.has_full_access, reason: row.access_reason, slug: row.effective_plan_slug, max: row.max_employees })), expected.map((item) => ({ full: item.hasActiveAccess, reason: item.accessReason, slug: item.effectivePlanCode, max: item.planCapabilities.maxEmployees })));
  } finally {
    psql(`delete from auth.users where id in ('${owner("01")}','${owner("02")}','${owner("03")}','${owner("04")}','${owner("05")}','${owner("06")}')`);
  }
});

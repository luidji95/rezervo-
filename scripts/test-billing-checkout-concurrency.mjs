import { randomUUID } from "node:crypto";

import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-billing-sandbox-concurrency");
const psql = (sql, label = "billing sandbox concurrency") => postgres.sqlSession(sql, label);

try {
  await postgres.initialize();
  for (let iteration = 1; iteration <= 3; iteration += 1) {
  const ownerId = randomUUID();
  const salonId = randomUUID();
  const key = randomUUID();
  const slug = `billing-concurrency-${randomUUID().slice(0, 8)}`;
  await psql(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${ownerId}','${ownerId}@example.invalid','{}','{}'); insert into public.salons(id,owner_id,name,slug) values('${salonId}','${ownerId}','Billing concurrency','${slug}');`);
  const before = await psql(`select row_to_json(s)::text from (select plan_id,status,billing_provider,billing_environment,provider_customer_id,provider_subscription_id,trial_starts_at,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at_period_end,cancelled_at from public.subscriptions where salon_id='${salonId}') s;`);
  const insert = () => psql(`insert into public.billing_checkout_sessions(salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key) select '${salonId}','${ownerId}',id,'lemonsqueezy','test','${key}' from public.plans where slug='starter';`, `iteration ${iteration} concurrent insert`);
  const results = await Promise.allSettled([insert(), insert()]);
  if (results.filter((result) => result.status === "fulfilled").length !== 1 || results.filter((result) => result.status === "rejected").length !== 1) {
    throw new Error(`Iteration ${iteration}: idempotency race did not produce one winner`);
  }
  const count = await psql(`select count(*) from public.billing_checkout_sessions where provider='lemonsqueezy' and environment='test' and idempotency_key='${key}';`);
  if (count !== "1") throw new Error(`Iteration ${iteration}: expected one checkout ledger, got ${count}`);
  const correlationIds = await psql(`select count(distinct id) from public.billing_checkout_sessions where provider='lemonsqueezy' and environment='test' and idempotency_key='${key}';`);
  if (correlationIds !== "1") throw new Error(`Iteration ${iteration}: expected one database correlation ID, got ${correlationIds}`);
  const after = await psql(`select row_to_json(s)::text from (select plan_id,status,billing_provider,billing_environment,provider_customer_id,provider_subscription_id,trial_starts_at,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at_period_end,cancelled_at from public.subscriptions where salon_id='${salonId}') s;`);
  if (before !== after) throw new Error(`Iteration ${iteration}: checkout changed subscription state`);
  await psql(`delete from public.billing_checkout_sessions where salon_id='${salonId}'; delete from auth.users where id='${ownerId}';`);
  }

  console.log("Billing checkout idempotency concurrency passed on disposable PostgreSQL (3 iterations); subscription state stayed unchanged.");
} finally {
  postgres.cleanup();
}

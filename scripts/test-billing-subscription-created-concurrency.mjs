import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec", "-i", "supabase_db_rezervo", "psql", "-X", "-q", "-A", "-t",
      "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d",
      process.env.BILLING_PROCESSOR_TEST_DATABASE ?? "postgres",
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`psql failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(sql);
  });
}

const ownerId = randomUUID();
const salonId = randomUUID();
const idempotencyKey = randomUUID();
const rawHash = createHash("sha256").update(randomUUID()).digest("hex");
const semantic = createHash("sha256").update(randomUUID()).digest("hex");
let eventId = "";

try {
  eventId = await psql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values('${ownerId}','${ownerId}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
    values('${salonId}','${ownerId}','Processor concurrency','processor-${salonId.slice(0, 8)}');
    insert into public.billing_provider_prices(
      plan_id,provider,environment,billing_interval,currency,amount,
      provider_product_id,provider_variant_id,provider_store_id,is_active
    ) select id,'lemonsqueezy','test','monthly','RSD',monthly_price,
      'concurrency-product','concurrency-variant','440512',true
      from public.plans where slug='starter'
    on conflict (provider,environment,plan_id,billing_interval,currency)
    do update set provider_product_id=excluded.provider_product_id,
      provider_variant_id=excluded.provider_variant_id,
      provider_store_id=excluded.provider_store_id,is_active=true;
    with checkout as (
      insert into public.billing_checkout_sessions(
        salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status
      ) select '${salonId}','${ownerId}',id,'lemonsqueezy','test','${idempotencyKey}','open'
        from public.plans where slug='starter' returning id
    ) select event_id from checkout c cross join lateral
      public.ingest_billing_webhook_event_v2(
        'lemonsqueezy','test','subscription_created','subscriptions','concurrency-sub',
        '${rawHash}','${semantic}','received',null,true,c.id,'${salonId}','starter',
        '${idempotencyKey}','concurrency-sub','concurrency-order','concurrency-customer',
        'concurrency-product','concurrency-variant','active',
        '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,'ready',null,
        '440512','2026-08-28T10:00:00Z',null,false,null,null,null
      );
  `);
  const calls = [1, 2].map(() => psql(
    `select outcome from public.process_billing_subscription_created_v1('${eventId}','2026-07-28T12:00:00Z');`,
  ));
  const outcomes = (await Promise.all(calls)).sort();
  if (outcomes[0] !== "already_processed" || outcomes[1] !== "processed") {
    throw new Error(`Unexpected processor outcomes: ${outcomes.join(",")}`);
  }
  const state = await psql(`select concat_ws('|',
    (select count(*) from public.subscriptions where salon_id='${salonId}' and status='active'),
    (select count(*) from public.billing_checkout_sessions where salon_id='${salonId}' and status='completed'),
    (select count(*) from public.billing_webhook_events where id='${eventId}' and processing_status='processed')
  );`);
  if (state !== "1|1|1") throw new Error(`Processor state is not singular: ${state}`);
  console.log("Billing subscription_created processor concurrency passed; one atomic mutation was applied.");
} finally {
  await psql(`
    delete from public.billing_webhook_events where id=nullif('${eventId}','')::uuid;
    delete from public.billing_checkout_sessions where salon_id='${salonId}';
    delete from public.salons where id='${salonId}';
    delete from auth.users where id='${ownerId}';
  `);
}

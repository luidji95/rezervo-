import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

function psql(sql) {
  const database = process.env.UPDATED_PROCESSOR_DB ?? "postgres";
  const container = process.env.UPDATED_PROCESSOR_DB_CONTAINER ?? "supabase_db_rezervo";
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec", "-i", container, "psql", "-XAt",
      "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database,
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

for (let iteration = 1; iteration <= 3; iteration += 1) {
  const ownerId = randomUUID();
  const salonId = randomUUID();
  const providerSubscriptionId = `updated-concurrency-${randomUUID()}`;
  const setup = await psql(`
    insert into public.billing_provider_prices(
      plan_id,provider,environment,billing_interval,currency,amount,
      provider_product_id,provider_variant_id,provider_store_id,is_active
    ) select id,'lemonsqueezy','test','monthly',currency,monthly_price,
      'product-concurrency','variant-concurrency','440512',true
      from public.plans where slug='starter'
    on conflict(provider,environment,plan_id,billing_interval,currency)
    do update set provider_product_id=excluded.provider_product_id,
      provider_variant_id=excluded.provider_variant_id,
      provider_store_id=excluded.provider_store_id,is_active=true;
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values('${ownerId}','${ownerId}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
    values('${salonId}','${ownerId}','Updated concurrency','updated-${salonId.slice(0, 8)}');
    update public.subscriptions set
      plan_id=(select id from public.plans where slug='starter'),status='active',
      billing_provider='lemonsqueezy',billing_environment='test',
      provider_customer_id='customer-concurrency',
      provider_subscription_id='${providerSubscriptionId}',
      current_period_starts_at='2026-07-28T10:00:00Z',
      current_period_ends_at='2026-08-01T10:00:00Z',
      provider_state_updated_at='2026-07-28T10:01:00Z'
    where salon_id='${salonId}';

    select event_id from public.ingest_billing_webhook_event_v2(
      'lemonsqueezy','test','subscription_updated','subscriptions','${providerSubscriptionId}',
      encode(sha256(('raw-old-${iteration}')::bytea),'hex'),
      encode(sha256(('semantic-old-${iteration}')::bytea),'hex'),
      'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
      '${providerSubscriptionId}','order-concurrency','customer-concurrency',
      'product-concurrency','variant-concurrency','active',
      '2026-07-28T10:00:00Z','2026-07-28T10:02:00Z',true,'ready',null,
      '440512','2026-08-28T10:00:00Z',null,false,null,null,null
    );
    select event_id from public.ingest_billing_webhook_event_v2(
      'lemonsqueezy','test','subscription_updated','subscriptions','${providerSubscriptionId}',
      encode(sha256(('raw-new-${iteration}')::bytea),'hex'),
      encode(sha256(('semantic-new-${iteration}')::bytea),'hex'),
      'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
      '${providerSubscriptionId}','order-concurrency','customer-concurrency',
      'product-concurrency','variant-concurrency','active',
      '2026-07-28T10:00:00Z','2026-07-28T10:03:00Z',true,'ready',null,
      '440512','2026-09-28T10:00:00Z',null,false,null,null,null
    );
  `);
  const eventIds = setup.split(/\r?\n/).filter((value) => /^[0-9a-f-]{36}$/.test(value));
  if (eventIds.length !== 2) throw new Error(`Iteration ${iteration}: fixture creation failed`);

  const results = await Promise.all(eventIds.map((eventId) => psql(`
    select outcome||coalesce('|'||error_code,'')
    from public.process_billing_subscription_updated_v1(
      '${eventId}','2026-07-28T12:00:00Z'
    );
  `)));
  if (results.some((result) => !["processed", "stale_ignored"].includes(result.split("|")[0]))) {
    throw new Error(`Iteration ${iteration}: unexpected outcomes ${results.join(",")}`);
  }

  const finalState = await psql(`
    select status||'|'||current_period_ends_at||'|'||provider_state_updated_at
    from public.subscriptions where salon_id='${salonId}';
  `);
  if (finalState !== "active|2026-09-28 10:00:00+00|2026-07-28 10:03:00+00") {
    throw new Error(`Iteration ${iteration}: newer provider state did not win`);
  }

  await psql(`
    delete from public.billing_webhook_events
    where provider_object_id='${providerSubscriptionId}';
    delete from public.salons where id='${salonId}';
    delete from auth.users where id='${ownerId}';
  `);
}

console.log("Updated subscription processor concurrency passed (3 iterations); newest provider state won.");

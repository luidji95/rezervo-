import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

function psql(sql) {
  const container = process.env.BILLING_WEBHOOK_DB_CONTAINER ?? "supabase_db_rezervo";
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec", "-i", container, "psql", "-X", "-A", "-t",
      "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
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

const protectedFingerprintSql = `
select md5(concat_ws('|',
  (select md5(coalesce(string_agg(row_to_json(p)::text,'|' order by p.id),'')) from public.plans p),
  (select md5(coalesce(string_agg(row_to_json(s)::text,'|' order by s.id),'')) from public.subscriptions s),
  (select md5(coalesce(string_agg(row_to_json(c)::text,'|' order by c.id),'')) from public.billing_checkout_sessions c)
));`;

for (let iteration = 1; iteration <= 3; iteration += 1) {
  const objectId = `concurrency-${randomUUID()}`;
  const payloadHashes = [randomUUID(), randomUUID()]
    .map((value) => createHash("sha256").update(value).digest("hex"));
  const semanticFingerprint = createHash("sha256")
    .update(`semantic-${randomUUID()}`)
    .digest("hex");
  const before = await psql(protectedFingerprintSql);
  const checkoutSessionId = randomUUID();
  const salonId = randomUUID();
  const idempotencyKey = randomUUID();
  const insert = (payloadHash) => psql(`
    select outcome from public.ingest_billing_webhook_event_v1(
      'lemonsqueezy','test','subscription_updated','subscriptions',
      '${objectId}','${payloadHash}','${semanticFingerprint}','received',null,true,
      '${checkoutSessionId}','${salonId}','pro','${idempotencyKey}',
      '${objectId}','order-${objectId}','customer-${objectId}',
      'product-${objectId}','variant-${objectId}','active',
      '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,'ready',null
    );`);
  const results = await Promise.allSettled(payloadHashes.map(insert));
  if (results.some((result) => result.status === "rejected")) {
    throw new Error(`Iteration ${iteration}: duplicate delivery returned an error`);
  }
  const outcomes = results.map((result) => result.value).sort();
  if (outcomes[0] !== "duplicate" || outcomes[1] !== "inserted") {
    throw new Error(`Iteration ${iteration}: expected one inserted and one duplicate outcome`);
  }
  const count = await psql(`
    select count(*) from public.billing_webhook_events
    where provider='lemonsqueezy' and environment='test'
      and semantic_fingerprint='${semanticFingerprint}';`);
  if (count !== "1") {
    throw new Error(`Iteration ${iteration}: expected one event row, got ${count}`);
  }
  const factsCount = await psql(`
    select count(*) from public.billing_webhook_subscription_facts f
    join public.billing_webhook_events e on e.id=f.webhook_event_id
    where e.semantic_fingerprint='${semanticFingerprint}';`);
  if (factsCount !== "1") {
    throw new Error(`Iteration ${iteration}: expected one facts row, got ${factsCount}`);
  }
  const after = await psql(protectedFingerprintSql);
  if (before !== after) {
    throw new Error(`Iteration ${iteration}: protected billing state changed`);
  }
  await psql(`delete from public.billing_webhook_events where semantic_fingerprint='${semanticFingerprint}';`);
}

console.log("Billing webhook DB concurrency passed (3 iterations); protected billing state stayed unchanged.");

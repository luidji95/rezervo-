import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec", "-i", "supabase_db_rezervo", "psql", "-X", "-A", "-t",
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
  const payloadHash = createHash("sha256").update(randomUUID()).digest("hex");
  const before = await psql(protectedFingerprintSql);
  const insert = () => psql(`
    insert into public.billing_webhook_events(
      provider,environment,event_name,provider_object_type,
      provider_object_id,payload_hash,processing_status
    ) values (
      'lemonsqueezy','test','subscription_updated','subscriptions',
      '${objectId}','${payloadHash}','received'
    );`);
  const results = await Promise.allSettled([insert(), insert()]);
  if (
    results.filter((result) => result.status === "fulfilled").length !== 1 ||
    results.filter((result) => result.status === "rejected").length !== 1
  ) {
    throw new Error(`Iteration ${iteration}: expected one unique-constraint winner`);
  }
  const count = await psql(`
    select count(*) from public.billing_webhook_events
    where provider='lemonsqueezy' and environment='test'
      and payload_hash='${payloadHash}';`);
  if (count !== "1") {
    throw new Error(`Iteration ${iteration}: expected one event row, got ${count}`);
  }
  const after = await psql(protectedFingerprintSql);
  if (before !== after) {
    throw new Error(`Iteration ${iteration}: protected billing state changed`);
  }
  await psql(`delete from public.billing_webhook_events where payload_hash='${payloadHash}';`);
}

console.log("Billing webhook DB concurrency passed (3 iterations); protected billing state stayed unchanged.");

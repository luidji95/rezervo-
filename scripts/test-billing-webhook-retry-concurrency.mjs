import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const container = process.env.BILLING_RETRY_DB_CONTAINER ?? "supabase_db_rezervo";
const database = process.env.BILLING_RETRY_DB ?? "postgres";
function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database]);
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Retry concurrency SQL failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(sql);
  });
}

for (let iteration = 1; iteration <= 3; iteration += 1) {
  const marker = randomUUID();
  const ids = [randomUUID(), randomUUID()];
  await psql(ids.map((id, index) => `
    insert into public.billing_webhook_events(
      id,provider,environment,event_name,provider_object_type,provider_object_id,
      payload_hash,semantic_fingerprint,processing_status,received_at,next_processing_attempt_at
    ) values(
      '${id}','lemonsqueezy','test','subscription_created','subscriptions','retry-${marker}-${index}',
      encode(sha256(('raw-${marker}-${index}')::bytea),'hex'),
      encode(sha256(('semantic-${marker}-${index}')::bytea),'hex'),
      'received','2026-07-29T09:00:00Z','2026-07-29T09:00:00Z'
    );`).join("\n"));

  const claimSql = `select webhook_event_id from public.claim_pending_billing_webhook_events_v2('test',1,'2026-07-29T10:00:00Z','5 minutes');`;
  const results = await Promise.all([psql(claimSql), psql(claimSql)]);
  const claimed = results.flatMap((result) => result.split(/\r?\n/)).filter((id) => ids.includes(id));
  if (claimed.length !== 2 || new Set(claimed).size !== 2) throw new Error(`Iteration ${iteration}: parallel claims overlapped or missed a fixture`);
  const metadata = await psql(`select count(*)||'|'||count(distinct processing_claim_token)||'|'||sum(processing_attempt_count) from public.billing_webhook_events where id in ('${ids.join("','")}');`);
  if (metadata !== "2|2|2") throw new Error(`Iteration ${iteration}: claim metadata mismatch`);
  await psql(`delete from public.billing_webhook_events where id in ('${ids.join("','")}');`);
}

console.log("Billing webhook retry claim concurrency passed (3 iterations); each event was claimed once with a unique token.");

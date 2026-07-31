import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const container = process.env.BILLING_CHECKOUT_RECOVERY_DB_CONTAINER ?? "supabase_db_rezervo";
const database = process.env.BILLING_CHECKOUT_RECOVERY_DB ?? "postgres";

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`Checkout recovery concurrency SQL failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(sql);
  });
}

const ownerId = randomUUID();
const salonId = randomUUID();
const checkoutId = randomUUID();

try {
  await psql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values('${ownerId}','${ownerId}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
      values('${salonId}','${ownerId}','Checkout recovery concurrency','checkout-recovery-${salonId.slice(0, 8)}');
    insert into public.billing_checkout_sessions(
      id,salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status,created_at,updated_at
    ) select '${checkoutId}','${salonId}','${ownerId}',id,'lemonsqueezy','test','${randomUUID()}','creating',
      '2026-07-31T10:00:00Z','2026-07-31T10:00:00Z'
      from public.plans where slug='pro';
  `);

  const claim = (now) => psql(`
    select claim_outcome||'|'||coalesce(recovery_attempt_id::text,'')||'|'||coalesce(claim_token::text,'')||'|'||coalesce(attempt_number::text,'')
    from public.claim_billing_checkout_recovery_v1('${checkoutId}','test','${now}','1 minute');
  `);

  const firstResults = await Promise.all(Array.from({ length: 6 }, () => claim("2026-07-31T10:10:00Z")));
  const firstClaimed = firstResults.filter((value) => value.startsWith("claimed|"));
  const firstBusy = firstResults.filter((value) => value.startsWith("already_claimed|"));
  if (firstClaimed.length !== 1 || firstBusy.length !== 5) {
    throw new Error(`Expected one initial claim and five busy results, received ${firstClaimed.length}/${firstBusy.length}`);
  }
  const [, firstAttemptId, firstToken, firstAttemptNumber] = firstClaimed[0].split("|");
  if (firstAttemptNumber !== "1") throw new Error("Initial attempt number was not one");

  const recoveryResults = await Promise.all(Array.from({ length: 6 }, () => claim("2026-07-31T10:11:01Z")));
  const recovered = recoveryResults.filter((value) => value.startsWith("claimed|"));
  const recoveredBusy = recoveryResults.filter((value) => value.startsWith("already_claimed|"));
  if (recovered.length !== 1 || recoveredBusy.length !== 5) {
    throw new Error(`Expected one lease-recovery claim and five busy results, received ${recovered.length}/${recoveredBusy.length}`);
  }
  const [, secondAttemptId, secondToken, secondAttemptNumber] = recovered[0].split("|");
  if (secondAttemptNumber !== "2" || secondToken === firstToken || secondAttemptId === firstAttemptId) {
    throw new Error("Lease recovery did not create a distinct second attempt");
  }

  const stale = await psql(`
    select completion_outcome from public.complete_billing_checkout_recovery_attempt_v1(
      '${secondAttemptId}','${firstToken}','test','still_pending','2026-07-31T10:11:02Z');
  `);
  if (stale !== "claim_lost") throw new Error("Stale token was not rejected for the new attempt");

  const completions = await Promise.all(Array.from({ length: 2 }, () => psql(`
    select completion_outcome from public.complete_billing_checkout_recovery_attempt_v1(
      '${secondAttemptId}','${secondToken}','test','still_pending','2026-07-31T10:11:03Z');
  `)));
  if (completions.filter((value) => value === "completed").length !== 1
    || completions.filter((value) => value === "already_completed").length !== 1) {
    throw new Error(`Parallel idempotent completion contract failed: ${completions.join(",")}`);
  }

  const metadata = await psql(`
    select count(*)||'|'||count(*) filter(where status='claimed')||'|'||max(attempt_number)||'|'||
      count(distinct claim_token)
    from public.billing_checkout_recovery_attempts where checkout_session_id='${checkoutId}';
  `);
  if (metadata !== "2|0|2|2") throw new Error(`Unexpected recovery-attempt metadata: ${metadata}`);

  console.log("Billing checkout recovery concurrency passed: one active claim, deterministic lease takeover, stale token rejected.");
} finally {
  await psql(`
    delete from public.billing_checkout_recovery_attempts where checkout_session_id='${checkoutId}';
    delete from public.billing_checkout_sessions where id='${checkoutId}';
    delete from public.salons where id='${salonId}';
    delete from auth.users where id='${ownerId}';
  `);
}

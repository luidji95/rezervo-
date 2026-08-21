import { randomUUID } from "node:crypto";

import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-checkout-recovery-concurrency");
const ownerId = randomUUID();
const salonId = randomUUID();
const checkoutId = randomUUID();

try {
  await postgres.initialize();
  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values('${ownerId}','${ownerId}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
      values('${salonId}','${ownerId}','Checkout recovery concurrency','checkout-recovery-${salonId.slice(0, 8)}');
    insert into public.billing_checkout_sessions(
      id,salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status,created_at,updated_at
    ) select '${checkoutId}','${salonId}','${ownerId}',id,'lemonsqueezy','test','${randomUUID()}','creating',
      '2026-07-31T10:00:00Z','2026-07-31T10:00:00Z' from public.plans where slug='pro';
  `, "recovery concurrency fixture");

  const claim = (now) => postgres.sqlSession(`
    select claim_outcome||'|'||coalesce(recovery_attempt_id::text,'')||'|'||coalesce(claim_token::text,'')||'|'||coalesce(attempt_number::text,'')
    from public.claim_billing_checkout_recovery_v1('${checkoutId}','test','${now}','1 minute');
  `, `claim at ${now}`);

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

  const stale = await postgres.sql(`
    select completion_outcome from public.complete_billing_checkout_recovery_attempt_v1(
      '${secondAttemptId}','${firstToken}','test','still_pending','2026-07-31T10:11:02Z');
  `, "stale token completion");
  if (stale !== "claim_lost") throw new Error("Stale token was not rejected for the new attempt");

  const completions = await Promise.all(Array.from({ length: 2 }, (_, index) => postgres.sqlSession(`
    select completion_outcome from public.complete_billing_checkout_recovery_attempt_v1(
      '${secondAttemptId}','${secondToken}','test','still_pending','2026-07-31T10:11:03Z');
  `, `parallel completion ${index + 1}`)));
  if (completions.filter((value) => value === "completed").length !== 1
    || completions.filter((value) => value === "already_completed").length !== 1) {
    throw new Error(`Parallel idempotent completion contract failed: ${completions.join(",")}`);
  }

  const metadata = await postgres.sql(`
    select count(*)||'|'||count(*) filter(where status='claimed')||'|'||max(attempt_number)||'|'||count(distinct claim_token)
    from public.billing_checkout_recovery_attempts where checkout_session_id='${checkoutId}';
  `, "recovery attempt metadata");
  if (metadata !== "2|0|2|2") throw new Error(`Unexpected recovery-attempt metadata: ${metadata}`);
  console.log("Billing checkout recovery concurrency passed on disposable PostgreSQL: one active claim, deterministic lease takeover, stale token rejected.");
} finally {
  postgres.cleanup();
}

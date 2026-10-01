import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-reminder-claim-quota");
const migration = readFileSync("supabase/migrations/202609010043_calendar_month_reminder_claim_quota.sql", "utf8")
  .replace(/^begin;\s*/, "").replace(/commit;\s*$/, "");
const salon = "43000000-0000-4000-8000-000000000002";
const owner = "43000000-0000-4000-8000-000000000001";
const client = "43000000-0000-4000-8000-000000000003";
const setup = `
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','claim-quota@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug,timezone) values('${salon}','${owner}','Claim quota','claim-quota-concurrency','Europe/Belgrade');
  update public.subscriptions set plan_id=(select id from public.plans where slug='pro'),status='trialing',trial_ends_at='2027-01-01T00:00:00Z' where salon_id='${salon}';
  insert into public.clients(id,salon_id,full_name,phone) values('${client}','${salon}','Quota fixture','+381641234567');
  insert into public.salon_reminder_settings(salon_id,enabled,channel,hours_before) values('${salon}',true,'sms',24);
  insert into public.appointments(id,salon_id,client_id,start_time,end_time,duration_minutes,price,status,idempotency_key)
    select ('43000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'${salon}','${client}',
      '2026-02-01T22:50:00Z'::timestamptz+n*interval '1 minute','2026-02-01T23:20:00Z'::timestamptz+n*interval '1 minute',30,1000,'pending',extensions.gen_random_uuid()
    from generate_series(1,4) n;
  insert into public.appointment_reminder_deliveries(salon_id,appointment_id,client_id,channel,scheduled_for,appointment_start_snapshot,recipient_snapshot,salon_timezone_snapshot)
    select salon_id,id,client_id,'sms',start_time-interval '24 hours',start_time,'+381641234567','Europe/Belgrade' from public.appointments where salon_id='${salon}';
`;

try {
  await postgres.initialize();
  await postgres.applySqlFile("supabase/baseline/local_platform_grant_normalization.sql", "local service-only ACL normalization");
  // This contract explicitly starts with no runtime environment configured.
  await postgres.applySqlFile("supabase/tests/billing_environment_entitlement_authority_contract.sql", "billing environment authority");
  await postgres.sql("insert into private.billing_runtime_config(singleton,environment) values(true,'test');", "test billing environment");
  await postgres.applySqlFile("supabase/tests/reminder_calendar_claim_quota_contract.sql", "calendar and claim-month boundaries");

  // Reconstruct the pre-column shape inside a transaction, then execute the actual
  // forward migration against historical claim evidence. No persistent test data.
  const legacy = `begin;
    drop trigger reminder_delivery_quota_period_immutable on public.appointment_reminder_deliveries;
    alter table public.appointment_reminder_deliveries drop column quota_period_start;
    ${setup}`;
  for (const [claim, expected] of [
    ["2026-01-31T22:59:00Z", "2025-12-31T23:00:00Z"],
    ["2026-03-29T12:00:00Z", "2026-02-28T23:00:00Z"],
    ["2026-10-25T12:00:00Z", "2026-09-30T22:00:00Z"],
  ]) {
    const result = await postgres.sql(`${legacy}
      update public.appointment_reminder_deliveries set status='sent',attempt_count=1,claimed_at='${claim}',sent_at='2026-11-01T00:01:00Z',provider='fixture',provider_message_id=id::text;
      ${migration}
      select count(*) from public.appointment_reminder_deliveries where salon_id='${salon}' and quota_period_start='${expected}';
      rollback;`, "single-attempt historical DST backfill");
    assert.equal(result, "4");
  }
  for (const state of ["processing", "retry_scheduled", "sent", "failed", "cancelled"]) {
    await assert.rejects(postgres.sql(`${legacy}
      update public.appointment_reminder_deliveries set status='${state}',attempt_count=2,claimed_at='2026-01-31T23:01:00Z';
      ${migration}`, `ambiguous historical ${state}`), /REMINDER_QUOTA_FIRST_CLAIM_UNPROVEN/);
  }
  await assert.rejects(postgres.sql(`${legacy}
    update public.appointment_reminder_deliveries set status='sent',attempt_count=1,sent_at='2026-01-31T23:01:00Z',provider_message_id=id::text;
    ${migration}`, "accepted without claim evidence"), /REMINDER_QUOTA_FIRST_CLAIM_UNPROVEN/);
  for (const zone of ["'Invalid/Timezone'", "''", "null"]) {
    await assert.rejects(postgres.sql(`${legacy}
      alter table public.appointment_reminder_deliveries alter column salon_timezone_snapshot drop not null;
      update public.appointment_reminder_deliveries set status='retry_scheduled',attempt_count=1,claimed_at='2026-01-31T22:59:00Z',salon_timezone_snapshot=${zone};
      ${migration}`, "invalid/missing historical timezone"), /REMINDER_QUOTA_TIMEZONE_EVIDENCE_INVALID/);
  }
  assert.equal(await postgres.sql(`select count(*) from pg_attribute where attrelid='public.appointment_reminder_deliveries'::regclass and attname='quota_period_start' and not attisdropped;`, "failed migrations rolled back"), "1");
  console.log("First-claim DB contract and historical fail-closed backfill passed.");

  for (const name of [
    "public_booking_subscription_access", "employee_capacity_contract", "appointment_mutation_contract",
    "business_data_mutation_contract", "reminder_canonical_entitlement_contract",
    "billing_environment_aware_subscription_processors_contract", "billing_subscription_invoice_evidence_contract",
  ]) {
    await postgres.applySqlFile(`supabase/tests/${name}.sql`, name);
  }

  await postgres.sql(`${setup} update public.plans set max_monthly_reminders=1 where slug='pro';`, "concurrency fixtures");
  const claims = await Promise.all([1, 2].map((worker) => postgres.sql(`
    begin;
    select count(*) from public.claim_due_appointment_reminders(1,'2026-01-31T23:00:00Z',10);
    select pg_sleep(0.2);
    commit;`, `parallel worker ${worker}`)));
  assert.equal(claims.reduce((total, count) => total + Number(count), 0), 1, "Only one worker may reserve the last slot");
  assert.equal(await postgres.sql(`select count(*) from public.appointment_reminder_deliveries where salon_id='${salon}' and status='processing' and quota_period_start='2026-01-31T23:00:00Z';`, "reservation key"), "1");

  // Finalization racing with another claim must never make the existing slot disappear.
  const [finalized, additional] = await Promise.all([
    postgres.sql(`select public.finalize_claimed_reminder_delivery(id,claim_token,'sent','2026-01-31T23:00:01Z','fixture','race-'||id) from public.appointment_reminder_deliveries where salon_id='${salon}' and status='processing';`, "parallel finalize"),
    postgres.sql("select count(*) from public.claim_due_appointment_reminders(1,'2026-01-31T23:00:01Z',10);", "claim while finalizing"),
  ]);
  assert.equal(finalized, "t");
  assert.equal(additional, "0");
  assert.equal(await postgres.sql(`select accepted_count||'|'||remaining from public.get_salon_reminder_usage('${salon}','2026-01-31T23:00:02Z');`, "accepted usage"), "1|0");
  // Race January retries with February first claims. Each month has one slot;
  // the two January retries must not both claim February's empty allowance.
  await postgres.sql(`
    delete from public.salons where id='${salon}'; delete from auth.users where id='${owner}';
    ${setup}
    update public.plans set max_monthly_reminders=2 where slug='pro';
    select count(*) from public.claim_due_appointment_reminders(2,'2026-01-31T22:55:00Z',10);
    select public.finalize_claimed_reminder_delivery(id,claim_token,'retry_scheduled','2026-01-31T22:56:00Z',p_next_retry_at=>'2026-01-31T23:01:00Z')
      from public.appointment_reminder_deliveries where salon_id='${salon}' and status='processing';
    update public.plans set max_monthly_reminders=1 where slug='pro';
  `, "January retries and never-claimed February candidates");
  const boundaryClaims = await Promise.all([1, 2, 3, 4].map((worker) => postgres.sql(`
    begin;
    select count(*) from public.claim_due_appointment_reminders(1,'2026-01-31T23:01:00Z',10);
    select pg_sleep(0.2);
    commit;`, `cross-month worker ${worker}`)));
  assert.equal(boundaryClaims.reduce((n, value) => n + Number(value), 0), 2, "One January retry and one February first claim");
  assert.equal(await postgres.sql(`select
    count(*) filter(where quota_period_start='2025-12-31T23:00:00Z')||'|'||
    count(*) filter(where quota_period_start='2026-01-31T23:00:00Z')
    from public.appointment_reminder_deliveries where salon_id='${salon}' and status='processing';`, "separate month reservations"), "1|1");
  assert.equal(await postgres.sql(`select count(*) from public.appointment_reminder_deliveries d
    cross join lateral public.validate_claimed_reminder_for_send(d.id,d.claim_token,'2026-01-31T23:01:01Z') v
    where d.salon_id='${salon}' and d.status='processing' and v.is_valid;`, "each stored month validates"), "2");
  await postgres.sql(`select public.finalize_claimed_reminder_delivery(id,claim_token,'sent','2026-01-31T23:01:02Z','fixture','boundary-'||id)
    from public.appointment_reminder_deliveries where salon_id='${salon}' and status='processing';`, "boundary finalization");
  assert.equal(await postgres.sql(`select
    (select accepted_count from public.get_salon_reminder_usage('${salon}','2026-01-31T22:59:00Z'))||'|'||
    (select accepted_count from public.get_salon_reminder_usage('${salon}','2026-01-31T23:01:03Z'));`, "separate accepted months"), "1|1");
  console.log("First-claim quota passed: January/February immutable retry/reclaim, DST/backfill/constraints, 8 canonical gateway/billing contracts; parallel claims, finalization race, 4-worker boundary race (January 1, February 1 at limit 1 each).");
} finally {
  postgres.cleanup();
}

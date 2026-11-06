import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Public bookings confirmed on creation (migration 202611050051) on a disposable PostgreSQL container only —
// never the persistent local database or a remote project. The schema is built up to 050, a public booking is
// created with the old (pending) behaviour, then 051 is applied and the contract runs.
const TARGET = "202611050051";
const SALON = "d2000000-0000-4000-8000-000000000051";
const OWNER = "d1000000-0000-4000-8000-000000000051";
const SERVICE = "d3000000-0000-4000-8000-000000000051";
const EMPLOYEE = "d4000000-0000-4000-8000-000000000051";
const postgres = createDisposableSupabasePostgres("rezervo-public-booking-confirmed");

const assert = (condition, message) => { if (!condition) throw new Error(message); };
// Slots on a fixed future day at whole hours; each case uses its own hour so cases never overlap.
const slot = (hour) => `date_trunc('day', now()) + interval '2 days' + interval '${hour} hours'`;
const book = (key, hour, name = "Javni Klijent") => `select appointment_id::text||'|'||was_created::text
  from public.create_public_booking_atomic('booking-confirmed','${SERVICE}','${EMPLOYEE}',${slot(hour)},'${name}','+381641234567','',
  '${key}')`;

try {
  // Same image and baseline as initialize(), but stop before the migration under test.
  const run = spawnSync("docker", ["run", "-d", "--network", "none", "--name", postgres.container,
    "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", "public.ecr.aws/supabase/postgres:17.6.1.121"], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (spawnSync("docker", ["exec", postgres.container, "pg_isready", "-U", "postgres"], { stdio: "ignore" }).status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await postgres.applySqlFile("supabase/baseline/schema.sql", "baseline schema");
  await postgres.applySqlFile("supabase/baseline/reference_seed.sql", "reference seed");
  const cutover = readFileSync("supabase/baseline/cutover.txt", "utf8").trim();
  const migrations = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql") && basename(n, ".sql") > cutover).sort();
  if (!migrations.some((n) => n.startsWith(TARGET))) throw new Error("migration under test not found");
  for (const m of migrations.filter((n) => n.split("_")[0] < TARGET)) await postgres.applySqlFile(`supabase/migrations/${m}`, m);

  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNER}','booking-confirmed@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled)
      values('${SALON}','${OWNER}','Booking Confirmed','booking-confirmed',true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) values('${EMPLOYEE}','${SALON}','Test Employee');
    insert into public.employee_services(salon_id,employee_id,service_id) values('${SALON}','${EMPLOYEE}','${SERVICE}');
  `, "fixture");
  const access = await postgres.sql(`select has_full_access from public.resolve_salon_access_v1('${SALON}',now())`, "access");
  assert(access === "t", `fixture salon must have full access, got ${access}`);

  // Pre-051 public booking keeps its pending status after the migration (no backfill).
  const oldKey = randomUUID();
  const [oldId] = (await postgres.sql(book(oldKey, 9), "pre-051 booking")).split("|");
  const oldRow = `select md5(a::text) from public.appointments a where a.id='${oldId}'`;
  const oldBefore = await postgres.sql(oldRow, "pre-051 row");
  assert(await postgres.sql(`select status from public.appointments where id='${oldId}'`, "old status") === "pending", "pre-051 booking must be pending");

  await postgres.applySqlFile(`supabase/migrations/${migrations.find((n) => n.startsWith(TARGET))}`, TARGET);
  assert(await postgres.sql(oldRow, "pre-051 row after") === oldBefore, "pre-051 appointment must be unchanged by 051");

  // 1. A new public booking is confirmed immediately, with confirmed_at, through the gated wrapper.
  const key = randomUUID();
  const [id, created] = (await postgres.sql(book(key, 10), "booking")).split("|");
  assert(created === "true", "first public request must create the appointment");
  const row = await postgres.sql(`select status||'|'||(confirmed_at is not null)::text||'|'||booking_source||'|'||payment_status
    ||'|'||(select count(*) from public.appointment_services s where s.appointment_id=a.id) from public.appointments a where a.id='${id}'`, "row");
  assert(row === "confirmed|true|public|unpaid|1", `unexpected appointment row ${row}`);

  // 2. Replaying the same request returns the same appointment without creating another one.
  const [replayId, replayCreated] = (await postgres.sql(book(key, 10), "replay")).split("|");
  assert(replayId === id && replayCreated === "false", "replay must return the original appointment with was_created=false");
  const [reuse] = await Promise.allSettled([postgres.sql(book(key, 11), "key reuse")]);
  assert(reuse.status === "rejected" && reuse.reason.message.includes("IDEMPOTENCY_CONFLICT"), "same key for another slot must be IDEMPOTENCY_CONFLICT");
  assert(await postgres.sql(`select count(*) from public.appointments where idempotency_key='${key}'`, "replay count") === "1", "replay created a duplicate");

  // 3. Parallel requests for the same slot with different keys: exactly one appointment.
  for (let iteration = 1; iteration <= 5; iteration += 1) {
    const hour = 12 + iteration;
    const results = await Promise.allSettled([
      postgres.sql(book(randomUUID(), hour, "Prvi Klijent"), `parallel-a-${iteration}`),
      postgres.sql(book(randomUUID(), hour, "Drugi Klijent"), `parallel-b-${iteration}`),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    assert(ok.length === 1 && failed.length === 1, `iteration ${iteration}: expected one success and one failure`);
    // The loser usually hits the overlap constraint; occasionally PostgreSQL reports a deadlock instead (pre-existing, same
    // rate without 051). Either way exactly one appointment exists, checked below.
    assert(/appointments_employee_time_no_overlap|23P01|conflicting key value violates exclusion constraint|deadlock detected/.test(failed[0].reason.message),
      `iteration ${iteration}: loser must fail on the overlap constraint, got ${failed[0].reason.message.slice(0, 200)}`);
    const count = await postgres.sql(`select count(*)||'|'||string_agg(status::text, ',') from public.appointments
      where employee_id='${EMPLOYEE}' and start_time=${slot(hour)}`, `parallel-count-${iteration}`);
    assert(count === "1|confirmed", `iteration ${iteration}: unexpected rows ${count}`);
  }

  // 4. Same-slot request after the slot is taken fails and creates nothing.
  const taken = await Promise.allSettled([postgres.sql(book(randomUUID(), 10, "Kasni Klijent"), "taken slot")]);
  assert(taken[0].status === "rejected", "booking a taken slot must fail");
  assert(await postgres.sql(`select count(*) from public.appointments where employee_id='${EMPLOYEE}' and start_time=${slot(10)}`, "taken count") === "1",
    "taken slot must still have exactly one appointment");

  // 5. Manual booking by the salon (owner RPC) is unchanged: still pending, booking_source manual.
  const manual = await postgres.sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${OWNER}',true);
    select appointment_status::text||'|'||was_created::text from public.create_owner_appointment_atomic_v1('${SALON}','${SERVICE}','${EMPLOYEE}',
      ${slot(20)},'Rucni Klijent','+381601111111','','', '${randomUUID()}'); commit;`, "owner booking");
  assert(manual.split(/\r?\n/).includes("pending|true"), `owner booking must stay pending, got ${manual}`);
  assert(await postgres.sql(`select string_agg(status||':'||booking_source, ',') from public.appointments where start_time=${slot(20)}`, "owner row") === "pending:manual",
    "owner appointment row must be pending/manual");

  // 6. Grants and function settings are unchanged.
  const acl = await postgres.sql(`select
    has_function_privilege('service_role','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('anon','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('authenticated','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('service_role','public.create_public_booking_atomic_unchecked_v1(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('anon','public.create_public_booking_atomic_unchecked_v1(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    (select prosecdef::text||':'||array_to_string(proconfig, ',') from pg_proc where oid='public.create_public_booking_atomic_unchecked_v1(text,uuid,uuid,timestamptz,text,text,text,uuid)'::regprocedure)`, "acl");
  assert(acl === "true|false|false|false|false|true:search_path=public, pg_temp", `unexpected grants/config ${acl}`);

  console.log("Public booking confirmed-on-create test passed (pre-051 row unchanged, confirmed + confirmed_at, idempotent replay, 5 parallel same-slot races, taken slot, owner booking pending, grants).");
} finally {
  postgres.cleanup();
}

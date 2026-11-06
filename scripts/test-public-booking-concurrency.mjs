import { randomUUID } from "node:crypto";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Concurrent public bookings for the same slot (migration 202611060053) on a disposable PostgreSQL container only —
// never the persistent local database or a remote project. Before 053 roughly 1 in 20 same-slot pairs ended in a
// deadlock (40P01) inside the exclusion constraint check; with the per-employee lock every loser must fail cleanly
// on the overlap constraint, same-key requests must replay, and no slot may hold more than one appointment.
const SALON = "f2000000-0000-4000-8000-000000000053";
const OWNER = "f1000000-0000-4000-8000-000000000053";
const SERVICE = "f3000000-0000-4000-8000-000000000053";
const EMPLOYEES = ["f4000000-0000-4000-8000-000000000053", "f4000000-0000-4000-8000-000000000054"];
const PAIRS = 40;
const postgres = createDisposableSupabasePostgres("rezervo-public-booking-concurrency");

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const slot = (index) => `date_trunc('day', now()) + interval '2 days' + make_interval(mins => ${index} * 30)`;
const book = (key, employee, index, name, phone) => `select appointment_id::text||'|'||was_created::text
  from public.create_public_booking_atomic('booking-concurrency','${SERVICE}','${employee}',${slot(index)},'${name}','${phone}','','${key}')`;
const outcome = (result) => result.status === "fulfilled" ? "ok"
  : /deadlock detected/.test(result.reason.message) ? "deadlock"
  : /appointments_employee_time_no_overlap|conflicting key value violates exclusion constraint/.test(result.reason.message) ? "overlap"
  : `other:${result.reason.message.slice(0, 160)}`;

try {
  await postgres.initialize();
  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNER}','booking-concurrency@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled) values('${SALON}','${OWNER}','Concurrency','booking-concurrency',true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) values('${EMPLOYEES[0]}','${SALON}','Prvi'),('${EMPLOYEES[1]}','${SALON}','Drugi');
    insert into public.employee_services(salon_id,employee_id,service_id) values('${SALON}','${EMPLOYEES[0]}','${SERVICE}'),('${SALON}','${EMPLOYEES[1]}','${SERVICE}');
  `, "fixture");

  // 1. Same slot, different keys, same and different phone numbers: one winner, loser always on the overlap constraint.
  const tally = {};
  for (const mode of ["samePhone", "differentPhone"]) for (let i = 0; i < PAIRS; i += 1) {
    const index = (mode === "samePhone" ? 0 : PAIRS) + i;
    // One number per pair (both requests share it), so the online limit of 3 future bookings per number (055) never applies.
    const phones = mode === "samePhone" ? [`+38163${String(i).padStart(7, "0")}`, `+38163${String(i).padStart(7, "0")}`] : [`+38164${String(i).padStart(7, "0")}`, `+38165${String(i).padStart(7, "0")}`];
    const results = await Promise.allSettled([
      postgres.sql(book(randomUUID(), EMPLOYEES[0], index, "Prvi Klijent", phones[0]), `race-a-${index}`),
      postgres.sql(book(randomUUID(), EMPLOYEES[0], index, "Drugi Klijent", phones[1]), `race-b-${index}`),
    ]);
    const key = results.map(outcome).sort().join("+");
    tally[key] = (tally[key] ?? 0) + 1;
  }
  assert(Object.keys(tally).length === 1 && tally["ok+overlap"] === 2 * PAIRS, `every pair must be one success + one overlap failure, got ${JSON.stringify(tally)}`);

  // 2. Same key sent concurrently: exactly one appointment, every caller gets its id, exactly one was_created=true.
  for (let i = 0; i < 10; i += 1) {
    const key = randomUUID();
    const rows = (await Promise.all([1, 2, 3, 4].map((n) => postgres.sql(book(key, EMPLOYEES[0], 200 + i, "Isti Kljuc", `+38169${String(i).padStart(7, "0")}`), `same-key-${i}-${n}`)))).map((r) => r.split("|"));
    assert(new Set(rows.map(([id]) => id)).size === 1 && rows.filter(([, created]) => created === "true").length === 1, `same-key burst ${i}: ${rows.join(" ")}`);
    assert(await postgres.sql(`select count(*) from public.appointments where idempotency_key='${key}'`, `same-key-count-${i}`) === "1", `same-key burst ${i} duplicated`);
  }

  // 3. The lock is per employee: the same time for two different employees books both.
  const both = await Promise.allSettled(EMPLOYEES.map((employee, n) => postgres.sql(book(randomUUID(), employee, 300, `Klijent ${n}`, `+38166000000${n}`), `parallel-employees-${n}`)));
  assert(both.every((r) => r.status === "fulfilled"), "different employees at the same time must both succeed");

  // 4. No slot holds more than one active appointment, and every public booking is confirmed.
  const summary = await postgres.sql(`select count(*)||'|'||count(distinct (employee_id, start_time))||'|'||string_agg(distinct status::text, ',')
    from public.appointments where salon_id='${SALON}'`, "summary");
  assert(summary === `${2 * PAIRS + 10 + 2}|${2 * PAIRS + 10 + 2}|confirmed`, `unexpected appointment summary ${summary}`);

  // 5. Grants and settings of the gated wrapper are unchanged; the unchecked function stays private.
  const acl = await postgres.sql(`select
    has_function_privilege('service_role','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('anon','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('authenticated','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('service_role','public.create_public_booking_atomic_unchecked_v1(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    (select prosecdef::text||':'||array_to_string(proconfig, ',') from pg_proc where oid='public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)'::regprocedure)`, "acl");
  assert(acl === `true|false|false|false|true:search_path=""`, `unexpected grants/config ${acl}`);

  console.log(`Public booking concurrency test passed (${2 * PAIRS} same-slot races without deadlock, 10 same-key bursts, per-employee lock, no duplicates, grants).`);
} finally {
  postgres.cleanup();
}

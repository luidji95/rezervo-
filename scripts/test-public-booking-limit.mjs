import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Online booking limit per normalized phone (migration 202611060055) on a disposable PostgreSQL container only — never
// the persistent local database or a remote project. The schema is built up to 054, then 055 is applied and the
// contract runs: at most 3 future pending/confirmed appointments per number and salon for public booking.
const TARGET = "202611060055";
const OWNER = "f1000000-0000-4000-8000-000000000055";
const OWNER_B = "f1000000-0000-4000-8000-000000000056";
const SALON = "f2000000-0000-4000-8000-000000000055";
const SALON_B = "f2000000-0000-4000-8000-000000000056";
const SERVICE = "f3000000-0000-4000-8000-000000000055";
const SERVICE_B = "f3000000-0000-4000-8000-000000000056";
const EMPLOYEES = ["f4000000-0000-4000-8000-000000000001", "f4000000-0000-4000-8000-000000000002", "f4000000-0000-4000-8000-000000000003"];
const EMPLOYEE_B = "f4000000-0000-4000-8000-000000000004";
const postgres = createDisposableSupabasePostgres("rezervo-public-booking-limit");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const slot = (index) => `date_trunc('day', now()) + interval '2 days' + make_interval(mins => ${index} * 30)`;
const book = ({ key = randomUUID(), salon = "booking-limit", service = SERVICE, employee = EMPLOYEES[0], index, phone, name = "Javni Klijent" }) =>
  postgres.sql(`select appointment_id::text||'|'||was_created::text from public.create_public_booking_atomic(${quote(salon)},'${service}','${employee}',
    ${slot(index)},${quote(name)},${quote(phone)},'','${key}')`, `book-${index}`).then((r) => r.split("|"));
const refusal = async (promise) => { const [r] = await Promise.allSettled([promise]); return r.status === "rejected" ? r.reason.message : "fulfilled"; };
const isLimit = (message) => message.includes("PUBLIC_BOOKING_LIMIT_REACHED");
const count = (sql) => postgres.sql(`select count(*) from ${sql}`, "count").then(Number);
const totals = () => postgres.sql(`select (select count(*) from public.appointments)||'|'||(select count(*) from public.clients)||'|'||(select count(*) from public.appointment_services)`, "totals");
const activeFuture = (phone, salon = SALON) => count(`public.appointments a join public.clients c on c.id=a.client_id
  where a.salon_id='${salon}' and a.status in ('pending','confirmed') and a.start_time > now() and public.normalize_phone_e164_v1(c.phone)=public.normalize_phone_e164_v1(${quote(phone)})`);
const ownerBook = (index, phone, employee = EMPLOYEES[2]) => postgres.sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${OWNER}',true);
  select appointment_status::text||'|'||was_created::text from public.create_owner_appointment_atomic_v1('${SALON}','${SERVICE}','${employee}',
    ${slot(index)},'Rucni Klijent',${quote(phone)},'','', '${randomUUID()}'); commit;`, "owner booking").then((out) => out.split(/\r?\n/).find((l) => l.includes("|")));
const functionMd5 = () => postgres.sql(`select string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname in ('create_public_booking_atomic','normalize_phone_e164_v1','create_owner_appointment_atomic_v1',
    'create_employee_appointment_atomic','create_employee_appointment_atomic_scoped_v1')`, "md5");
// Line endings follow the checkout (core.autocrlf), so sources are compared with LF.
const uncheckedSource = () => postgres.sql(`select prosrc from pg_proc where oid='public.create_public_booking_atomic_unchecked_v1(text,uuid,uuid,timestamptz,text,text,text,uuid)'::regprocedure`, "source").then((s) => s.replace(/\r\n/g, "\n"));

try {
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
  const target = migrations.find((n) => n.startsWith(TARGET));
  if (!target) throw new Error("migration under test not found");
  for (const m of migrations.filter((n) => n.split("_")[0] < TARGET)) await postgres.applySqlFile(`supabase/migrations/${m}`, m);

  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
      ('${OWNER}','booking-limit@example.invalid','{}','{}'),('${OWNER_B}','booking-limit-b@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled) values
      ('${SALON}','${OWNER}','Booking Limit','booking-limit',true,true),('${SALON_B}','${OWNER_B}','Booking Limit B','booking-limit-b',true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Sisanje',30,1000),('${SERVICE_B}','${SALON_B}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) values
      ('${EMPLOYEES[0]}','${SALON}','Prvi'),('${EMPLOYEES[1]}','${SALON}','Drugi'),('${EMPLOYEES[2]}','${SALON}','Treci'),('${EMPLOYEE_B}','${SALON_B}','B');
    insert into public.employee_services(salon_id,employee_id,service_id) values
      ('${SALON}','${EMPLOYEES[0]}','${SERVICE}'),('${SALON}','${EMPLOYEES[1]}','${SERVICE}'),('${SALON}','${EMPLOYEES[2]}','${SERVICE}'),('${SALON_B}','${EMPLOYEE_B}','${SERVICE_B}');
    -- Two cards with one number in two notations: the ambiguous-card rule (054) must keep answering for it.
    insert into public.clients(id,salon_id,full_name,phone,source) values
      ('f5000000-0000-4000-8000-000000000001','${SALON}','Dupli Jedan','0659990000','manual'),
      ('f5000000-0000-4000-8000-000000000002','${SALON}','Dupli Dva','+381 65 999 0000','manual');
  `, "fixture");
  const sourceBefore = await uncheckedSource();
  const md5Before = await functionMd5();

  // Baseline before 055: a 4th future booking of one number is accepted.
  for (const [n, index] of [[0, 1], [1, 2], [2, 3], [0, 4]]) await book({ employee: EMPLOYEES[n], index, phone: "061 000 0000" });
  assert(await activeFuture("061 000 0000") === 4, "pre-055 baseline: a 4th future booking must succeed");

  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 0. Only the limit block was added to the unchecked function; every other function is unchanged.
  const sourceAfter = await uncheckedSource();
  const stripped = sourceAfter.replace("  v_active_future_count integer;\n", "")
    .replace(/\n    -- Online booking limit:[\s\S]*?message = 'PUBLIC_BOOKING_LIMIT_REACHED';\n    end if;\n/, "");
  assert(stripped === sourceBefore && sourceAfter !== sourceBefore, "055 must change the unchecked function only by the limit block");
  assert(await functionMd5() === md5Before, "wrapper, normalizer and manual booking functions must be unchanged");
  assert(isLimit(await refusal(book({ employee: EMPLOYEES[1], index: 5, phone: "+381610000000" }))), "the pre-existing 4 bookings already exceed the limit");

  // 1. Third passes, fourth is refused and writes nothing; all notations count as one number.
  const keys = [];
  for (const [n, phone, index] of [[0, "064 100 0001", 10], [1, "+381 64 100 0001", 10], [2, "00381641000001", 10]]) {
    const key = randomUUID(); keys.push(key);
    const [, created] = await book({ key, employee: EMPLOYEES[n], index, phone });
    assert(created === "true", `booking ${keys.length} of 3 must be created`);
  }
  assert(await count(`public.clients where salon_id='${SALON}' and phone='+381641000001'`) === 1, "the three bookings share one client");
  const beforeFourth = await totals();
  for (const [n, phone] of [[0, "0641000001"], [1, "+381 (64) 100-0001"], [2, "+381 064 100 0001"]]) {
    const message = await refusal(book({ employee: EMPLOYEES[n], index: 11, phone }));
    assert(isLimit(message), `4th booking (${phone}) must be refused with PUBLIC_BOOKING_LIMIT_REACHED, got ${message}`);
  }
  assert(await totals() === beforeFourth, "a refused booking must not write an appointment, client or service snapshot");

  // 3. Replay of the third booking with its key returns the same appointment although the limit is reached.
  const third = await postgres.sql(`select id from public.appointments where idempotency_key='${keys[2]}'`, "third");
  const [replayId, replayCreated] = await book({ key: keys[2], employee: EMPLOYEES[2], index: 10, phone: "+381641000001" });
  assert(replayId === third && replayCreated === "false" && await totals() === beforeFourth, "replay must return the existing appointment without writing");

  // 2. Parallel public requests: two existing bookings, two concurrent requests with different keys for different
  //    employees and one number in two notations -> exactly one is created. Repeated to exercise the race.
  const ROUNDS = 25;
  let parallelLimit = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const national = `62${String(round).padStart(7, "0")}`;
    const base = 20 + round * 4;
    await book({ employee: EMPLOYEES[2], index: base, phone: `0${national}` });
    await book({ employee: EMPLOYEES[2], index: base + 1, phone: `+381${national}` });
    const results = await Promise.allSettled([
      book({ employee: EMPLOYEES[0], index: base + 2, phone: `0${national.slice(0, 2)} ${national.slice(2)}` }),
      book({ employee: EMPLOYEES[1], index: base + 2, phone: `+381 ${national.slice(0, 2)} ${national.slice(2)}` }),
    ]);
    const created = results.filter((r) => r.status === "fulfilled" && r.value[1] === "true").length;
    const limited = results.filter((r) => r.status === "rejected" && isLimit(r.reason.message)).length;
    assert(created === 1 && limited === 1, `round ${round}: expected 1 created + 1 PUBLIC_BOOKING_LIMIT_REACHED, got ${results.map((r) => r.status === "fulfilled" ? "created" : r.reason.message.slice(0, 80)).join(" / ")}`);
    assert(await activeFuture(`+381${national}`) === 3, `round ${round}: exactly 3 future active bookings`);
    parallelLimit += limited;
  }

  // 4. Only future pending/confirmed count; cancelling frees a place; another salon is counted separately.
  const STATUS_CLIENT = "f5000000-0000-4000-8000-000000000010";
  await postgres.sql(`insert into public.clients(id,salon_id,full_name,phone,source) values('${STATUS_CLIENT}','${SALON}','Statusi','0633000000','manual');
    insert into public.appointments(salon_id,client_id,employee_id,primary_service_id,start_time,end_time,duration_minutes,buffer_minutes,price,currency,status,payment_status,booking_source)
    select '${SALON}','${STATUS_CLIENT}','${EMPLOYEES[2]}','${SERVICE}', s, s + interval '30 minutes', 30, 0, 1000, 'RSD', st::public.appointment_status, 'unpaid', 'manual'
    from (values (now() - interval '2 days', 'confirmed'), (now() - interval '3 days', 'pending'), (${slot(200)}, 'cancelled'), (${slot(201)}, 'completed'), (${slot(202)}, 'no_show')) v(s, st);`, "status fixture");
  const statusKeys = [];
  for (const [n, index] of [[0, 210], [1, 210], [2, 211]]) { const key = randomUUID(); statusKeys.push(key); await book({ key, employee: EMPLOYEES[n], index, phone: "+381633000000" }); }
  assert(isLimit(await refusal(book({ employee: EMPLOYEES[0], index: 212, phone: "063 300 0000" }))), "past, cancelled, completed and no-show appointments must not count; the 4th future active is refused");
  await postgres.sql(`update public.appointments set status='cancelled' where idempotency_key='${statusKeys[0]}'`, "cancel");
  const [, afterCancel] = await book({ employee: EMPLOYEES[0], index: 212, phone: "063 300 0000" });
  assert(afterCancel === "true", "cancelling one appointment must free a place");
  const [, otherSalon] = await book({ salon: "booking-limit-b", service: SERVICE_B, employee: EMPLOYEE_B, index: 212, phone: "064 100 0001" });
  assert(otherSalon === "true", "a number at the limit in one salon must still book in another salon");

  // 5. Manual appointments (stored as typed, e.g. 065…) count by number; manual booking itself is never blocked.
  for (const index of [220, 221]) assert((await ownerBook(index, "065 200 0002"))?.startsWith("pending|true"), "manual booking must be created");
  const [, thirdManual] = await book({ employee: EMPLOYEES[0], index: 222, phone: "+381652000002" });
  assert(thirdManual === "true", "two manual + one public = three: allowed");
  assert(isLimit(await refusal(book({ employee: EMPLOYEES[1], index: 223, phone: "0652000002" }))), "manual bookings in domestic notation must count toward the public limit");
  assert((await ownerBook(224, "065 200 0002"))?.startsWith("pending|true"), "owner manual booking must not be blocked by the limit");
  assert(await activeFuture("065 200 0002") === 4, "the manual 4th booking exists");

  // 6. The ambiguous-card rule is unchanged and keeps its own answer.
  const ambiguous = await refusal(book({ employee: EMPLOYEES[0], index: 230, phone: "065 999 0000" }));
  assert(ambiguous.includes("CLIENT_CONTACT_SALON"), `ambiguous number must still be refused with CLIENT_CONTACT_SALON, got ${ambiguous}`);

  // 7. Grants unchanged.
  const acl = await postgres.sql(`select
    has_function_privilege('service_role','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('anon','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('service_role','public.create_public_booking_atomic_unchecked_v1(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('anon','public.normalize_phone_e164_v1(text)','execute')::text`, "acl");
  assert(acl === "true|false|false|false", `unexpected grants ${acl}`);

  console.log(`Public booking limit test passed (only the limit block changed, 3rd allowed / 4th refused without writes in any notation, replay at the limit, ${ROUNDS} parallel rounds with ${parallelLimit} refusals and 0 extra bookings, past/cancelled/completed/no-show not counted, cancel frees a place, salons separate, manual bookings counted but not blocked, CLIENT_CONTACT_SALON unchanged, grants).`);
} finally {
  postgres.cleanup();
}

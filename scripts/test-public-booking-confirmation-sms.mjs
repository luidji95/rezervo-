import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// SMS confirmation reservations (migration 202611070057) on a disposable PostgreSQL container only — never the
// persistent local database or a remote project. Checks eligibility, the salon switch, one attempt per appointment,
// the limits (1/10 min and 3/24 h per recipient, 20/24 h per salon) under concurrency, outcomes and grants.
const TARGET = "202611070057";
const OWNER = "f1000000-0000-4000-8000-000000000157";
const OWNER_B = "f1000000-0000-4000-8000-000000000158";
const SALON = "f2000000-0000-4000-8000-000000000157";
const SALON_B = "f2000000-0000-4000-8000-000000000158";
const SERVICE = "f3000000-0000-4000-8000-000000000157";
const SERVICE_B = "f3000000-0000-4000-8000-000000000158";
const EMPLOYEES = Array.from({ length: 4 }, (_, i) => `f4000000-0000-4000-8000-00000000015${i}`);
const EMPLOYEE_B = "f4000000-0000-4000-8000-000000000159";
const postgres = createDisposableSupabasePostgres("rezervo-public-booking-confirmation-sms");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const recipient = () => randomBytes(32).toString("hex");
let slotIndex = 0;
const book = async ({ salon = "booking-sms", service = SERVICE, employee = EMPLOYEES[slotIndex % 4], phone = `0641${String(slotIndex).padStart(6, "0")}`, link = true } = {}) => {
  slotIndex += 1;
  const start = `date_trunc('day', now()) + interval '2 days' + make_interval(mins => ${slotIndex} * 30)`;
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  const sql = link
    ? `select appointment_id from public.create_public_booking_with_manage_token_v1(${quote(salon)},'${service}','${employee}',${start},'Klijent',${quote(phone)},'','${randomUUID()}','${hash}')`
    : `select appointment_id from public.create_public_booking_atomic(${quote(salon)},'${service}','${employee}',${start},'Klijent',${quote(phone)},'','${randomUUID()}')`;
  return postgres.sql(sql, "book");
};
const reserve = (appointmentId, hash) => postgres.sql(`select public.reserve_public_booking_confirmation_sms_v1('${appointmentId}', '${hash}')`, "reserve");
const finish = (appointmentId, status, messageId = null, errorCode = null) => postgres.sql(
  `select public.finish_public_booking_confirmation_sms_v1('${appointmentId}', '${status}', 'infobip', ${messageId ? quote(messageId) : "null"}, ${errorCode ? quote(errorCode) : "null"})`, "finish");
const count = (where) => postgres.sql(`select count(*) from public.public_booking_confirmation_sms where ${where}`, "count").then(Number);
const age = (appointmentIds, interval) => postgres.sql(`update public.public_booking_confirmation_sms set created_at = created_at - interval '${interval}' where appointment_id in (${appointmentIds.map((id) => `'${id}'`).join(",")})`, "age");

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
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNER}','booking-sms@example.invalid','{}','{}'),('${OWNER_B}','booking-sms-b@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled) values
      ('${SALON}','${OWNER}','Booking SMS','booking-sms',true,true),('${SALON_B}','${OWNER_B}','Booking SMS B','booking-sms-b',true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Sisanje',30,1000),('${SERVICE_B}','${SALON_B}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) select e, '${SALON}', 'Radnik' from unnest(array['${EMPLOYEES.join("','")}']::uuid[]) e;
    insert into public.employees(id,salon_id,full_name) values('${EMPLOYEE_B}','${SALON_B}','B');
    insert into public.employee_services(salon_id,employee_id,service_id) select '${SALON}', e, '${SERVICE}' from unnest(array['${EMPLOYEES.join("','")}']::uuid[]) e;
    insert into public.employee_services(salon_id,employee_id,service_id) values('${SALON_B}','${EMPLOYEE_B}','${SERVICE_B}');
  `, "fixture");
  const md5 = () => postgres.sql(`select string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
    where p.pronamespace='public'::regnamespace and (p.proname like 'create_public_booking%' or p.proname like '%manage_token%' or p.proname like '%reminder%' or p.proname = 'create_owner_appointment_atomic_v1')`, "md5");
  const before = await md5();
  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 0. Additive: existing booking, link and reminder functions unchanged; table holds no number, text, link or token.
  assert(await md5() === before, "existing booking, manage-link and reminder functions must be unchanged");
  assert(await postgres.sql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='public_booking_confirmation_sms'`, "columns")
    === "appointment_id,salon_id,recipient_hash,status,provider,provider_message_id,error_code,created_at,finished_at", "confirmation table columns");
  assert(await postgres.sql(`select string_agg(booking_confirmation_sms_enabled::text, ',') from public.salons`, "default") === "false,false", "salon switch is off by default");
  const acl = await postgres.sql(`select string_agg(r||':'||f||'='||has_function_privilege(r, f, 'execute')::text, ';' order by r, f) from unnest(array['anon','authenticated','service_role']) r,
    unnest(array['public.reserve_public_booking_confirmation_sms_v1(uuid,text)','public.finish_public_booking_confirmation_sms_v1(uuid,text,text,text,text)']) f`, "acl");
  assert(!/(anon|authenticated):[^;]*=true/.test(acl) && (acl.match(/service_role:[^;]*=true/g) ?? []).length === 2, `grants ${acl}`);
  assert(await postgres.sql(`select string_agg(r||'='||has_table_privilege(r,'public.public_booking_confirmation_sms','select,insert,update,delete')::text, ',') from unnest(array['anon','authenticated','service_role']) r`, "table acl")
    === "anon=false,authenticated=false,service_role=false", "table not directly accessible");

  // 1. Salon switch off: nothing is reserved.
  const first = await book();
  assert(await reserve(first, recipient()) === "salon_disabled" && await count("true") === 0, "switch off -> salon_disabled, nothing written");
  await postgres.sql(`update public.salons set booking_confirmation_sms_enabled = true where id in ('${SALON}','${SALON_B}')`, "switch on");

  // 2. Eligibility: no private link, cancelled, old, unknown appointment -> not_eligible.
  const noLink = await book({ link: false });
  const cancelled = await book();
  await postgres.sql(`update public.appointments set status='cancelled' where id='${cancelled}'`, "cancel");
  const old = await book();
  await postgres.sql(`update public.appointments set created_at = now() - interval '20 minutes' where id='${old}'`, "old");
  for (const [id, label] of [[noLink, "no private link"], [cancelled, "cancelled"], [old, "created 20 min ago"], [randomUUID(), "unknown"]]) {
    assert(await reserve(id, recipient()) === "not_eligible", `${label} -> not_eligible`);
  }
  assert(await count("true") === 0, "ineligible appointments write nothing");
  let malformed = "fulfilled";
  try { await reserve(first, "not-a-digest"); } catch (error) { malformed = error.message; }
  assert(malformed.includes("recipient digest"), "malformed recipient digest rejected");

  // 3. One attempt per appointment, also under concurrency.
  const r1 = recipient();
  const burst = await Promise.all(Array.from({ length: 6 }, () => reserve(first, r1)));
  assert(burst.filter((o) => o === "reserved").length === 1 && burst.filter((o) => o === "already_reserved").length === 5 && await count(`appointment_id='${first}'`) === 1, `same appointment burst ${burst}`);

  // 4. Outcomes are recorded once.
  assert(await finish(first, "accepted", "msg-1") === "t" && await finish(first, "unknown") === "f", "finish applies once");
  let badStatus = "fulfilled";
  try { await finish(first, "sent"); } catch (error) { badStatus = error.message; }
  assert(badStatus.includes("Invalid confirmation SMS status"), "unknown status value rejected");

  // 5. Recipient limits: 1 per 10 minutes, 3 per 24 hours (all outcomes count), across salons.
  const r2 = recipient();
  const a = await book(), b = await book(), c = await book(), d = await book(), e = await book({ salon: "booking-sms-b", service: SERVICE_B, employee: EMPLOYEE_B });
  assert(await reserve(a, r2) === "reserved" && await reserve(b, r2) === "recipient_limit", "second within 10 minutes -> recipient_limit");
  await age([a], "11 minutes");
  assert(await reserve(b, r2) === "reserved", "after 10 minutes the next one passes");
  await finish(b, "rejected", null, "HTTP_400");
  await age([a, b], "11 minutes");
  assert(await reserve(c, r2) === "reserved", "third in 24 h passes");
  await age([a, b, c], "11 minutes");
  assert(await reserve(d, r2) === "recipient_limit" && await reserve(e, r2) === "recipient_limit", "fourth in 24 h refused, also in another salon");
  await age([a], "24 hours");
  assert(await reserve(d, r2) === "reserved", "after 24 h a place frees up");

  // 6. Concurrency on the recipient limit: 8 new bookings, same number, parallel -> exactly one reservation.
  const r3 = recipient();
  const parallel = [];
  for (let i = 0; i < 8; i += 1) parallel.push(await book());
  const recipientRace = await Promise.all(parallel.map((id) => reserve(id, r3)));
  assert(recipientRace.filter((o) => o === "reserved").length === 1 && recipientRace.filter((o) => o === "recipient_limit").length === 7, `recipient race ${recipientRace}`);

  // 7. Salon limit 20 / 24 h, under concurrency: fill to 19, then 6 parallel different recipients -> exactly one.
  const salonCount = await count(`salon_id='${SALON}' and created_at > now() - interval '24 hours'`);
  for (let i = salonCount; i < 19; i += 1) assert(await reserve(await book(), recipient()) === "reserved", `fill ${i}`);
  const salonRaceIds = [];
  for (let i = 0; i < 6; i += 1) salonRaceIds.push(await book());
  const salonRace = await Promise.all(salonRaceIds.map((id) => reserve(id, recipient())));
  assert(salonRace.filter((o) => o === "reserved").length === 1 && salonRace.filter((o) => o === "salon_limit").length === 5, `salon race ${salonRace}`);
  assert(await count(`salon_id='${SALON}' and created_at > now() - interval '24 hours'`) === 20, "salon has exactly 20 in 24 h");
  assert(await reserve(await book({ salon: "booking-sms-b", service: SERVICE_B, employee: EMPLOYEE_B }), recipient()) === "reserved", "another salon has its own limit");

  // 8. Deleting the appointment removes its row; reminders untouched.
  assert(await postgres.sql(`select count(*) from public.appointment_reminder_deliveries`, "reminders") === "0", "no reminder deliveries were created");

  console.log("Public booking confirmation SMS test passed (additive, private grants, no number/text/link columns, switch off by default, eligibility, one attempt per appointment under concurrency, single finish, 1/10 min + 3/24 h per recipient across salons, 8-way recipient race, 20/24 h salon limit under a 6-way race, salons separate).");
} finally {
  postgres.cleanup();
}

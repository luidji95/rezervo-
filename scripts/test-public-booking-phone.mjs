import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";
import { PHONE_CASES } from "../src/lib/phone/phoneNumber.cases.ts";
import { normalizePhoneToE164 } from "../src/lib/phone/phoneNumber.ts";

// Required, E.164-normalized phone for public bookings (migration 202611060054) on a disposable PostgreSQL container
// only — never the persistent local database or a remote project. The schema is built up to 053, existing clients in
// several notations are created, then 054 is applied and the contract runs. Run with --experimental-strip-types.
const TARGET = "202611060054";
const SALON = "e2000000-0000-4000-8000-000000000054";
const OWNER = "e1000000-0000-4000-8000-000000000054";
const SERVICE = "e3000000-0000-4000-8000-000000000054";
const EMPLOYEES = ["e4000000-0000-4000-8000-000000000054", "e4000000-0000-4000-8000-000000000055"];
const postgres = createDisposableSupabasePostgres("rezervo-public-booking-phone");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const slot = (index) => `date_trunc('day', now()) + interval '2 days' + make_interval(mins => ${index} * 30)`;
const book = ({ key = randomUUID(), employee = EMPLOYEES[0], index, name = "Javni Klijent", phone, email = "" }) =>
  postgres.sql(`select appointment_id::text||'|'||was_created::text||'|'||'${key}' from public.create_public_booking_atomic('booking-phone','${SERVICE}','${employee}',
    ${slot(index)},${quote(name)},${quote(phone)},${quote(email)},'${key}')`, `book-${index}`).then((r) => r.split("|"));
const clientOf = (appointmentId) => postgres.sql(`select c.id::text||'|'||coalesce(c.phone,'')||'|'||coalesce(c.email,'')||'|'||c.source
  from public.appointments a join public.clients c on c.id = a.client_id where a.id = '${appointmentId}'`, "client");
const count = (sql) => postgres.sql(`select count(*) from ${sql}`, "count").then(Number);

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
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNER}','booking-phone@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled) values('${SALON}','${OWNER}','Booking Phone','booking-phone',true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) values('${EMPLOYEES[0]}','${SALON}','Prvi'),('${EMPLOYEES[1]}','${SALON}','Drugi');
    insert into public.employee_services(salon_id,employee_id,service_id) values('${SALON}','${EMPLOYEES[0]}','${SERVICE}'),('${SALON}','${EMPLOYEES[1]}','${SERVICE}');
    -- Existing clients as they can be stored today (manual booking keeps the typed notation).
    insert into public.clients(id,salon_id,full_name,phone,email,source) values
      ('e5000000-0000-4000-8000-000000000001','${SALON}','Domaci Zapis','064 123 4567',null,'manual'),
      ('e5000000-0000-4000-8000-000000000002','${SALON}','Dupli Jedan','0651112222',null,'manual'),
      ('e5000000-0000-4000-8000-000000000003','${SALON}','Dupli Dva','+381 65 111 2222',null,'manual'),
      ('e5000000-0000-4000-8000-000000000004','${SALON}','Samo Email',null,'samo@primer.rs','manual'),
      ('e5000000-0000-4000-8000-000000000005','${SALON}','Inostrani','+44 20 7946 0958',null,'manual'),
      ('e5000000-0000-4000-8000-000000000006','${SALON}','Isti E164 Jedan','+381667778888',null,'manual'),
      ('e5000000-0000-4000-8000-000000000007','${SALON}','Isti E164 Dva','+381667778888',null,'public'),
      ('e5000000-0000-4000-8000-000000000008','${SALON}','Email Drugi Telefon','+381609990000','deli@primer.rs','manual');
  `, "fixture");
  const FIXTURE_CLIENTS = 8;
  const clientsBefore = await postgres.sql(`select md5(string_agg(c::text, '' order by id)) from public.clients c`, "clients before");
  const ownerRpcBefore = await postgres.sql(`select md5(prosrc) from pg_proc where oid='public.create_owner_appointment_atomic_v1(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)'::regprocedure`, "owner rpc");

  // Before 054 the RPC accepted an email-only booking and matched phones only by exact text.
  const [legacyId] = await book({ index: 1, phone: "", email: "legacy@primer.rs" });
  assert(Boolean(legacyId), "pre-054 email-only booking must succeed (baseline)");
  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 1. SQL normalizer = TS normalizer for every shared case.
  for (const [input, expected] of PHONE_CASES) {
    const ts = normalizePhoneToE164(input);
    const sql = await postgres.sql(`select coalesce(public.normalize_phone_e164_v1(${quote(input)}), 'NULL')`, "normalize");
    assert((ts.ok ? ts.e164 : null) === expected && sql === (expected ?? "NULL"), `normalizer mismatch for ${JSON.stringify(input)}: ts=${JSON.stringify(ts)} sql=${sql}`);
  }

  // 2. Phone is required and must be valid; nothing is written otherwise.
  const before = await count("public.appointments");
  for (const [phone, email] of [["", "bez.telefona@primer.rs"], ["   ", ""], ["641234567", "x@primer.rs"], ["064 123", ""], ["+12345", ""]]) {
    const [result] = await Promise.allSettled([book({ index: 2, phone, email })]);
    assert(result.status === "rejected" && /valid phone number is required|22023/.test(result.reason.message), `phone ${JSON.stringify(phone)} must be rejected, got ${result.status}`);
  }
  assert(await count("public.appointments") === before && await count(`public.clients where salon_id='${SALON}'`) === FIXTURE_CLIENTS + 1, "rejected bookings must not write appointments or clients");

  // 3. 064… and +381 64… are the same person: both link to the existing domestic-notation client, which is not rewritten.
  const [a1] = await book({ index: 3, phone: "+381 64 123 4567" });
  const [a2] = await book({ index: 4, phone: "0641234567", employee: EMPLOYEES[1] });
  const c1 = await clientOf(a1), c2 = await clientOf(a2);
  assert(c1 === c2 && c1.startsWith("e5000000-0000-4000-8000-000000000001|064 123 4567|"), `064/+381 must reuse the existing client unchanged, got ${c1} / ${c2}`);

  // 4. A new number is stored once as E.164; later notations of it link to that client.
  const [n1] = await book({ index: 5, phone: "063 555 0101" });
  const [n2] = await book({ index: 6, phone: "+381635550101", employee: EMPLOYEES[1] });
  const cn = await clientOf(n1);
  assert(cn === await clientOf(n2) && cn.split("|")[1] === "+381635550101" && cn.endsWith("|public"), `new client must be stored as E.164 and reused, got ${cn}`);

  // 5. Several clients with one number (all notations counted together): no client is chosen, none is created,
  //    no appointment is written, and the error is the neutral CLIENT_CONTACT_SALON.
  const clientsInSalon = () => count(`public.clients where salon_id='${SALON}'`);
  for (const [label, phone] of [["one domestic + one international record", "065 111 2222"], ["same record, other notation", "+381 65 111 2222"],
    ["two records with the identical E.164 number", "066 777 8888"], ["identical E.164 typed as E.164", "+381667778888"]]) {
    const appointmentsBefore = await count("public.appointments"), clientsBeforeCase = await clientsInSalon();
    const [result] = await Promise.allSettled([book({ index: 7, phone, email: "nov@primer.rs" })]);
    assert(result.status === "rejected" && result.reason.message.includes("CLIENT_CONTACT_SALON"), `${label}: must be refused with CLIENT_CONTACT_SALON, got ${result.status}`);
    assert(await count("public.appointments") === appointmentsBefore && await clientsInSalon() === clientsBeforeCase, `${label}: nothing may be written`);
  }

  // 6. Email is never used to find a client: an email that belongs to a card with another phone (or with no phone)
  //    gets a new client with the booking's phone; the existing cards stay unchanged.
  const [e1] = await book({ index: 9, phone: "062 333 4444", email: "deli@primer.rs" });
  const ce = await clientOf(e1);
  assert(!ce.startsWith("e5000000-0000-4000-8000-000000000008") && ce.split("|").slice(1).join("|") === "+381623334444|deli@primer.rs|public", `email of another card must not link, got ${ce}`);
  const [e2] = await book({ index: 10, phone: "062 555 6666", email: "samo@primer.rs", employee: EMPLOYEES[1] });
  assert(!(await clientOf(e2)).startsWith("e5000000-0000-4000-8000-000000000004"), "email of a phone-less card must not link");

  // 7. International numbers are accepted and matched in any notation.
  const [i1] = await book({ index: 10, phone: "0044 20 7946 0958" });
  assert((await clientOf(i1)).startsWith("e5000000-0000-4000-8000-000000000005|+44 20 7946 0958|"), `international number must match the existing client, got ${await clientOf(i1)}`);

  // 8. Valid booking without email: confirmed, confirmed_at set; idempotent replay returns the same appointment.
  const key = randomUUID();
  const [v1, created] = await book({ key, index: 11, phone: "064 222 3333" });
  assert(created === "true" && await postgres.sql(`select status||'|'||(confirmed_at is not null) from public.appointments where id='${v1}'`, "status") === "confirmed|true", "valid booking must be confirmed");
  const [v2, replayCreated] = await book({ key, index: 11, phone: "+381 64 222 3333" });
  assert(v2 === v1 && replayCreated === "false" && await count(`public.appointments where idempotency_key='${key}'`) === 1, "replay must return the same appointment without a duplicate");

  // 9. Concurrent first bookings of one new number (two employees, same time) share one client.
  const results = await Promise.all(EMPLOYEES.map((employee, n) => book({ employee, index: 12, phone: n ? "+381 61 444 5555" : "061 444 5555", name: `Paralelni ${n}` })));
  const parallelClients = new Set(await Promise.all(results.map(([id]) => clientOf(id).then((c) => c.split("|")[0]))));
  assert(parallelClients.size === 1, `parallel first bookings of one number must share a client, got ${parallelClients.size}`);

  // 10. Existing clients are never rewritten; the manual (owner) booking path is unchanged.
  const clientsAfter = await postgres.sql(`select md5(string_agg(c::text, '' order by id)) from public.clients c where id::text like 'e5000000%'`, "clients after");
  assert(clientsAfter === clientsBefore, "existing clients must be byte-for-byte unchanged (no rewrite, merge or backfill)");
  assert(await postgres.sql(`select md5(prosrc) from pg_proc where oid='public.create_owner_appointment_atomic_v1(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)'::regprocedure`, "owner rpc after") === ownerRpcBefore,
    "owner booking RPC must be unchanged");
  const manual = await postgres.sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${OWNER}',true);
    select appointment_status::text||'|'||was_created::text from public.create_owner_appointment_atomic_v1('${SALON}','${SERVICE}','${EMPLOYEES[0]}',
      ${slot(20)},'Rucni Klijent','','rucni@primer.rs','', '${randomUUID()}'); commit;`, "owner booking");
  assert(manual.split(/\r?\n/).includes("pending|true"), `owner booking (email only) must still work and stay pending, got ${manual}`);

  // 11. Grants: the normalizer is internal; the unchecked function stays private.
  const acl = await postgres.sql(`select
    has_function_privilege('anon','public.normalize_phone_e164_v1(text)','execute')::text||'|'||
    has_function_privilege('authenticated','public.normalize_phone_e164_v1(text)','execute')::text||'|'||
    has_function_privilege('service_role','public.create_public_booking_atomic(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    has_function_privilege('service_role','public.create_public_booking_atomic_unchecked_v1(text,uuid,uuid,timestamptz,text,text,text,uuid)','execute')::text||'|'||
    (select provolatile::text from pg_proc where oid='public.normalize_phone_e164_v1(text)'::regprocedure)`, "acl");
  assert(acl === "false|false|true|false|i", `unexpected grants ${acl}`);

  console.log(`Public booking phone test passed (${PHONE_CASES.length} TS=SQL normalizer cases, required/invalid phone writes nothing, 064=+381 link to the existing client unchanged, E.164 storage, several matches refused without writes, email never used for linking, international, confirmed + idempotent replay, parallel first booking, owner path unchanged, grants).`);
} finally {
  postgres.cleanup();
}

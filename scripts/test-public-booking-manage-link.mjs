import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Private manage link for public bookings (migration 202611060056) on a disposable PostgreSQL container only — never
// the persistent local database or a remote project. The schema is built up to 055, a booking without a link is made,
// then 056 is applied and the contract runs: the link digest is attached atomically, replays keep the same link,
// viewing never writes, cancellation is atomic with one notification and a 2-hour deadline.
const TARGET = "202611060056";
const OWNER = "f1000000-0000-4000-8000-000000000156";
const SALON = "f2000000-0000-4000-8000-000000000156";
const SERVICE = "f3000000-0000-4000-8000-000000000156";
const EMPLOYEES = ["f4000000-0000-4000-8000-000000000011", "f4000000-0000-4000-8000-000000000012", "f4000000-0000-4000-8000-000000000013"];
const postgres = createDisposableSupabasePostgres("rezervo-public-booking-manage");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const slot = (index) => `date_trunc('day', now()) + interval '2 days' + make_interval(mins => ${index} * 30)`;
const newToken = () => randomBytes(32).toString("base64url");
const digest = (token) => createHash("sha256").update(token, "utf8").digest("hex");
const args = ({ key, employee = EMPLOYEES[0], index, phone = "064 555 0000", start }) =>
  `'booking-manage','${SERVICE}','${employee}',${start ?? slot(index)},'Javni Klijent',${quote(phone)},'','${key}'`;
const bookWithLink = ({ key = randomUUID(), hash, ...rest }) => postgres.sql(`select appointment_id::text||'|'||was_created::text||'|'||manage_access::text
  from public.create_public_booking_with_manage_token_v1(${args({ key, ...rest })},${quote(hash)})`, "book-link").then((r) => r.split("|"));
const bookLegacy = ({ key = randomUUID(), ...rest }) => postgres.sql(`select appointment_id::text||'|'||was_created::text
  from public.create_public_booking_atomic(${args({ key, ...rest })})`, "book-legacy").then((r) => r.split("|"));
const view = (hash) => postgres.sql(`select coalesce(json_agg(v)::text, '[]') from public.get_public_booking_by_manage_token_v1(${quote(hash)}) v`, "view").then(JSON.parse);
const cancel = (hash) => postgres.sql(`select outcome from public.cancel_public_booking_by_manage_token_v1(${quote(hash)})`, "cancel");
const refusal = async (promise) => { const [r] = await Promise.allSettled([promise]); return r.status === "rejected" ? r.reason.message : "fulfilled"; };
const count = (sql) => postgres.sql(`select count(*) from ${sql}`, "count").then(Number);
const fingerprint = () => postgres.sql(`select md5(coalesce((select string_agg(a::text, '' order by id) from public.appointments a), '') ||
  coalesce((select string_agg(t::text, '' order by appointment_id) from public.public_booking_manage_tokens t), '') ||
  coalesce((select string_agg(n::text, '' order by id) from public.notifications n), '') || coalesce((select string_agg(c::text, '' order by id) from public.clients c), ''))`, "fingerprint");
const cancelNotifications = (appointmentId) => count(`public.notifications where entity_id='${appointmentId}' and type='appointment_cancelled'`);
const functionMd5 = () => postgres.sql(`select string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname in ('create_public_booking_atomic','create_public_booking_atomic_unchecked_v1',
    'normalize_phone_e164_v1','create_owner_appointment_atomic_v1','update_owner_appointment_status_v1','claim_due_appointment_reminders')`, "md5");

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
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNER}','booking-manage@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,phone,booking_enabled,online_booking_enabled) values('${SALON}','${OWNER}','Booking Manage','booking-manage','011 222 3333',true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) values('${EMPLOYEES[0]}','${SALON}','Prvi'),('${EMPLOYEES[1]}','${SALON}','Drugi'),('${EMPLOYEES[2]}','${SALON}','Treci');
    insert into public.employee_services(salon_id,employee_id,service_id) select '${SALON}', e, '${SERVICE}' from unnest(array['${EMPLOYEES.join("','")}']::uuid[]) e;
  `, "fixture");

  // A booking made before 056 (no link).
  const legacyKey = randomUUID();
  const [legacyId] = await bookLegacy({ key: legacyKey, index: 1 });
  const md5Before = await functionMd5();
  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 0. Additive only: every existing function is unchanged; grants are private.
  assert(await functionMd5() === md5Before, "existing booking, status and reminder functions must be unchanged");
  const acl = await postgres.sql(`select string_agg(r||':'||f||'='||has_function_privilege(r, f, 'execute')::text, ';' order by r, f) from
    unnest(array['anon','authenticated','service_role']) r, unnest(array[
      'public.create_public_booking_with_manage_token_v1(text,uuid,uuid,timestamptz,text,text,text,uuid,text)',
      'public.get_public_booking_manage_token_state_v1(uuid,text)','public.get_public_booking_by_manage_token_v1(text)',
      'public.cancel_public_booking_by_manage_token_v1(text)','public.parse_public_booking_manage_token_hash_v1(text)']) f`, "acl");
  assert(!/(anon|authenticated):[^;]*=true/.test(acl) && (acl.match(/service_role:[^;]*=true/g) ?? []).length === 4 && acl.includes("service_role:public.parse_public_booking_manage_token_hash_v1(text)=false"),
    `unexpected function grants ${acl}`);
  const tableAcl = await postgres.sql(`select string_agg(r||'='||has_table_privilege(r,'public.public_booking_manage_tokens','select,insert,update,delete')::text, ',')
    from unnest(array['anon','authenticated','service_role']) r`, "table acl");
  assert(tableAcl === "anon=false,authenticated=false,service_role=false", `token table must not be readable or writable directly: ${tableAcl}`);

  // 1. Old link-less booking: replay through the new function returns it without a link and creates none.
  const [legacyReplay, legacyCreated, legacyAccess] = await bookWithLink({ key: legacyKey, index: 1, hash: digest(newToken()) });
  assert(legacyReplay === legacyId && legacyCreated === "false" && legacyAccess === "false" && await count("public.public_booking_manage_tokens") === 0,
    "a booking made without a link must stay without one (no link generated afterwards)");
  assert(await postgres.sql(`select public.get_public_booking_manage_token_state_v1('${legacyId}', '${digest(newToken())}')`, "state") === "absent", "state of a link-less booking is 'absent'");

  // 2. Booking with a link: the digest is attached atomically; the same key + same digest replays with the link;
  //    another digest is refused and the stored digest is never replaced.
  const token = newToken(), hash = digest(token), key = randomUUID();
  const [id, created, access] = await bookWithLink({ key, index: 2, hash });
  assert(created === "true" && access === "true", "booking with a link must be created with manage access");
  assert(await postgres.sql(`select encode(token_hash,'hex') from public.public_booking_manage_tokens where appointment_id='${id}'`, "stored") === hash, "only the digest is stored");
  const [replayId, replayCreated, replayAccess] = await bookWithLink({ key, index: 2, hash });
  assert(replayId === id && replayCreated === "false" && replayAccess === "true" && await count(`public.appointments where idempotency_key='${key}'`) === 1, "lost-response replay returns the same booking and link");
  const beforeMismatch = await fingerprint();
  assert((await refusal(bookWithLink({ key, index: 2, hash: digest(newToken()) }))).includes("IDEMPOTENCY_CONFLICT"), "a replay with another token must be refused");
  assert(await fingerprint() === beforeMismatch, "a refused replay writes nothing and keeps the original digest");
  assert((await refusal(bookWithLink({ index: 3, hash: "not-a-digest" }))).includes("manage token digest"), "malformed digest is rejected");
  assert(await fingerprint() === beforeMismatch, "malformed digest writes nothing");
  assert(await postgres.sql(`select public.get_public_booking_manage_token_state_v1('${id}', '${hash}')||','||public.get_public_booking_manage_token_state_v1('${id}', '${digest(newToken())}')`, "states") === "match,mismatch", "token state match/mismatch");

  // Concurrent same-key requests with the same token: one booking, one digest, every caller gets the link.
  const burstToken = digest(newToken()), burstKey = randomUUID();
  const burst = await Promise.all([1, 2, 3, 4].map(() => bookWithLink({ key: burstKey, employee: EMPLOYEES[1], index: 4, hash: burstToken, phone: "064 555 0001" })));
  assert(new Set(burst.map(([bid]) => bid)).size === 1 && burst.filter(([, c]) => c === "true").length === 1 && burst.every(([, , a]) => a === "true")
    && await count(`public.public_booking_manage_tokens where token_hash=decode('${burstToken}','hex')`) === 1, `same-key burst: ${burst.join(" ")}`);

  // 3. Viewing is read-only and returns no client data; unknown or malformed digests return nothing.
  const beforeView = await fingerprint();
  const [shown] = await view(hash);
  assert(JSON.stringify(Object.keys(shown).sort()) === JSON.stringify(["can_cancel", "cancel_deadline", "end_time", "salon_name", "salon_phone", "salon_slug", "salon_timezone", "service_name", "start_time", "status"]),
    `view must expose only salon/service/time/status fields, got ${Object.keys(shown)}`);
  assert(shown.salon_name === "Booking Manage" && shown.service_name === "Sisanje" && shown.status === "confirmed" && shown.can_cancel === true, `view content ${JSON.stringify(shown)}`);
  for (const bad of [digest(newToken()), "", "zz", hash.toUpperCase(), hash.slice(0, 63)]) assert((await view(bad)).length === 0, `digest ${bad.slice(0, 8)} must show nothing`);
  assert(await cancel(digest(newToken())) === "not_found" && await cancel("garbage") === "not_found", "unknown/malformed digest cannot cancel");
  assert(await fingerprint() === beforeView, "viewing and failed cancel attempts must not write anything");

  // A token row for a non-public appointment (cannot be created by the app) still grants nothing.
  const [manualId] = (await postgres.sql(`insert into public.appointments(salon_id,client_id,employee_id,primary_service_id,start_time,end_time,duration_minutes,price,status,booking_source)
    select '${SALON}', client_id, '${EMPLOYEES[2]}', '${SERVICE}', ${slot(40)}, ${slot(41)}, 30, 1000, 'pending', 'manual' from public.appointments where id='${id}' returning id`, "manual")).split("\n");
  const manualHash = digest(newToken());
  await postgres.sql(`insert into public.public_booking_manage_tokens(appointment_id, token_hash) values('${manualId}', decode('${manualHash}','hex'))`, "manual token");
  assert((await view(manualHash)).length === 0 && await cancel(manualHash) === "not_found", "only public bookings can be viewed or cancelled by link");

  // 4. The 2-hour deadline: exactly 2 hours before the start is allowed, one microsecond later is not.
  const boundaryHash = digest(newToken());
  const [boundaryId] = await bookWithLink({ employee: EMPLOYEES[2], index: 6, hash: boundaryHash, phone: "064 555 0002" });
  const atBoundary = async (offset) => (await postgres.sql(`begin;
    update public.appointments set start_time = now() + interval '2 hours' + interval '${offset}', end_time = now() + interval '2 hours 30 minutes' + interval '${offset}' where id='${boundaryId}';
    select 'view=' || can_cancel::text from public.get_public_booking_by_manage_token_v1('${boundaryHash}');
    select 'cancel=' || outcome from public.cancel_public_booking_by_manage_token_v1('${boundaryHash}');
    rollback;`, "boundary")).split(/\r?\n/).filter((l) => l.includes("=")).join(",");
  assert(await atBoundary("0 seconds") === "view=true,cancel=cancelled", `exactly 2h before start must be cancellable (${await atBoundary("0 seconds")})`);
  assert(await atBoundary("-1 microsecond") === "view=false,cancel=too_late", "less than 2h before start must be too late");
  const pastStart = await postgres.sql(`begin; update public.appointments set start_time = now() - interval '1 hour', end_time = now() - interval '30 minutes' where id='${boundaryId}';
    select outcome from public.cancel_public_booking_by_manage_token_v1('${boundaryHash}'); rollback;`, "past");
  assert(pastStart.split(/\r?\n/).includes("too_late"), "a started appointment is too late");
  for (const status of ["completed", "no_show"]) {
    const outcome = await postgres.sql(`begin; update public.appointments set status='${status}' where id='${boundaryId}';
      select outcome from public.cancel_public_booking_by_manage_token_v1('${boundaryHash}'); rollback;`, status);
    assert(outcome.split(/\r?\n/).includes("not_cancellable"), `${status} is not cancellable`);
  }
  assert(await postgres.sql(`select status from public.appointments where id='${boundaryId}'`, "boundary status") === "confirmed" && await cancelNotifications(boundaryId) === 0, "boundary checks rolled back");

  // 5. Reminder setup: a pending delivery for the appointment that will be cancelled and one for an active appointment.
  const [reminderControlId] = await bookWithLink({ employee: EMPLOYEES[1], index: 8, hash: digest(newToken()), phone: "064 555 0003" });
  await postgres.sql(`insert into public.salon_reminder_settings(salon_id,enabled,hours_before) values('${SALON}',true,24);
    insert into public.appointment_reminder_deliveries(salon_id,appointment_id,client_id,channel,scheduled_for,appointment_start_snapshot,salon_timezone_snapshot)
    select salon_id,id,client_id,'sms',start_time - interval '24 hours',start_time,'Europe/Belgrade' from public.appointments where id in ('${id}','${reminderControlId}');`, "reminder fixture");

  // 6. Parallel cancellation: one change, one notification; the rest see already_cancelled.
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => cancel(hash)));
  assert(outcomes.filter((o) => o === "cancelled").length === 1 && outcomes.filter((o) => o === "already_cancelled").length === 7, `parallel cancel outcomes ${outcomes}`);
  assert(await cancelNotifications(id) === 1, "exactly one salon notification for the cancellation");
  assert(await postgres.sql(`select status||'|'||(cancelled_at is not null)::text||'|'||cancelled_by from public.appointments where id='${id}'`, "cancelled row") === "cancelled|true|public_manage_link", "appointment marked cancelled by the link");
  assert(await cancel(hash) === "already_cancelled" && await cancelNotifications(id) === 1, "repeated click: no second notification");
  const [afterCancel] = await view(hash);
  assert(afterCancel.status === "cancelled" && afterCancel.can_cancel === false, "view shows the cancelled status");

  // The cancelled appointment is no longer eligible for a reminder; the active one keeps its delivery.
  await postgres.sql(`select count(*) from public.claim_due_appointment_reminders(50, now(), 10)`, "claim");
  const deliveries = await postgres.sql(`select string_agg(appointment_id::text||'='||status::text||':'||coalesce(last_error_code,''), ',' order by appointment_id = '${id}' desc) from public.appointment_reminder_deliveries`, "deliveries");
  // The active control stays eligible (still pending, or already claimed for sending); only the cancelled one is invalidated.
  assert(new RegExp(`^${id}=cancelled:SCHEDULE_INVALIDATED,${reminderControlId}=(pending|processing):$`).test(deliveries), `reminder for the cancelled appointment is invalidated, the active one stays eligible (${deliveries})`);

  // 7. The slot and the online limit place are released.
  const [rebookedId, rebooked] = await bookWithLink({ index: 2, hash: digest(newToken()), phone: "065 777 0000" });
  assert(rebooked === "true" && rebookedId !== id, "the cancelled slot can be booked again");
  const limitHashes = [];
  for (const index of [10, 11, 12]) { const h = digest(newToken()); limitHashes.push(h); await bookWithLink({ index, hash: h, phone: "063 444 0000" }); }
  assert((await refusal(bookWithLink({ index: 13, hash: digest(newToken()), phone: "063 444 0000" }))).includes("PUBLIC_BOOKING_LIMIT_REACHED"), "limit reached");
  assert(await cancel(limitHashes[0]) === "cancelled", "cancel one of three");
  assert((await bookWithLink({ index: 13, hash: digest(newToken()), phone: "+381634440000" }))[1] === "true", "cancelling frees a place in the online limit");

  // 8. Salon inactive, new bookings switched off and access ended: existing links keep working within the deadline.
  const lateHash = digest(newToken());
  await bookWithLink({ employee: EMPLOYEES[1], index: 20, hash: lateHash, phone: "064 555 0004" });
  await postgres.sql(`update public.salons set status='inactive', online_booking_enabled=false, booking_enabled=false where id='${SALON}';
    update public.subscriptions set trial_ends_at = now() - interval '1 day', current_period_ends_at = now() - interval '1 day' where salon_id='${SALON}';`, "switch off");
  const accessNow = await postgres.sql(`select coalesce(has_full_access, false)::text from public.resolve_salon_access_v1('${SALON}', now())`, "access");
  assert(accessNow === "false", `fixture: salon access must be gone (got ${accessNow})`);
  assert((await refusal(bookWithLink({ employee: EMPLOYEES[0], index: 30, hash: digest(newToken()), phone: "064 555 0005" }))).includes("PUBLIC_BOOKING_UNAVAILABLE"), "new public bookings are refused");
  assert((await view(lateHash))[0]?.can_cancel === true && await cancel(lateHash) === "cancelled", "an existing booking stays viewable and cancellable while the salon is inactive, booking is off and access has ended");

  console.log("Public booking manage link test passed (additive migration, private grants, no links for old bookings, atomic digest + same-link replay, mismatch refused, same-key burst, read-only view without client data, invalid/foreign/non-public links, exact 2h deadline, completed/no-show, 8 parallel cancels -> 1 change + 1 notification, reminder invalidated, slot and limit released, cancellable with an inactive salon, booking off and no access).");
} finally {
  postgres.cleanup();
}

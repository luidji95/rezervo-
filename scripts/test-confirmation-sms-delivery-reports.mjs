import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Delivery reports for booking-confirmation SMS (migration 202611070058) on a disposable PostgreSQL container only —
// never the persistent local database or a remote project. Fake reports only; nothing is sent.
const TARGET = "202611070058";
const OWNER = "f1000000-0000-4000-8000-000000000258";
const SALON = "f2000000-0000-4000-8000-000000000258";
const SERVICE = "f3000000-0000-4000-8000-000000000258";
const EMPLOYEES = Array.from({ length: 4 }, (_, i) => `f4000000-0000-4000-8000-00000000025${i}`);
const postgres = createDisposableSupabasePostgres("rezervo-confirmation-sms-dlr");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);
let slotIndex = 0;

const confirmation = async ({ messageId = `msg-${randomUUID()}`, finish = true } = {}) => {
  slotIndex += 1;
  const id = await postgres.sql(`select appointment_id from public.create_public_booking_with_manage_token_v1('booking-dlr','${SERVICE}','${EMPLOYEES[slotIndex % 4]}',
    date_trunc('day', now()) + interval '2 days' + make_interval(mins => ${slotIndex} * 30),'Klijent','0641${String(slotIndex).padStart(6, "0")}','','${randomUUID()}',
    '${createHash("sha256").update(randomBytes(32)).digest("hex")}')`, "book");
  // Older rows out of the 24-hour salon window, so the limit of 20 does not interfere with this test.
  await postgres.sql(`update public.public_booking_confirmation_sms set created_at = created_at - interval '25 hours'`, "age rows");
  const reserved = await postgres.sql(`select public.reserve_public_booking_confirmation_sms_v1('${id}', '${randomBytes(32).toString("hex")}')`, "reserve");
  assert(reserved === "reserved", `reserve ${reserved}`);
  if (finish) await finishSms(id, messageId);
  return { id, messageId };
};
const finishSms = (id, messageId) => postgres.sql(`select public.finish_public_booking_confirmation_sms_v1('${id}', 'accepted', 'infobip', ${quote(messageId)}, null)`, "finish");
const report = (messageId, group, { statusId = null, name = null, errorCode = null, errorName = null, permanent = null, doneAt = null } = {}) =>
  postgres.sql(`select public.apply_confirmation_sms_delivery_report_v1(${quote(messageId)}, ${statusId ?? "null"}, ${quote(group)}, ${quote(name)}, ${quote(errorCode)}, ${quote(errorName)},
    ${permanent === null ? "null" : permanent}, ${doneAt ? `'${doneAt}'::timestamptz` : "null"}, now())`, "report");
const state = (id) => postgres.sql(`select status||'|'||coalesce(delivery_status,'-')||'|'||coalesce(delivery_status_name,'-')||'|'||coalesce(delivery_error_code,'-')||'|'||coalesce(delivery_error_permanent::text,'-')
  ||'|'||coalesce(to_char(delivery_done_at at time zone 'UTC','HH24:MI:SS'),'-') from public.public_booking_confirmation_sms where appointment_id='${id}'`, "state");
const rowPrint = (id) => postgres.sql(`select md5(t::text) from public.public_booking_confirmation_sms t where appointment_id='${id}'`, "print");
const early = (messageId) => postgres.sql(`select coalesce((select status_group||'|'||coalesce(status_name,'-') from public.infobip_early_delivery_reports where provider_message_id=${quote(messageId)}), 'none')`, "early");
const T = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

try {
  const run = spawnSync("docker", ["run", "-d", "--network", "none", "--name", postgres.container,
    "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", "public.ecr.aws/supabase/postgres:17.6.1.121"], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (spawnSync("docker", ["exec", postgres.container, "pg_isready", "-U", "postgres"], { stdio: "ignore" }).status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 8000));
  await postgres.applySqlFile("supabase/baseline/schema.sql", "baseline schema");
  await postgres.applySqlFile("supabase/baseline/reference_seed.sql", "reference seed");
  const cutover = readFileSync("supabase/baseline/cutover.txt", "utf8").trim();
  const migrations = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql") && basename(n, ".sql") > cutover).sort();
  const target = migrations.find((n) => n.startsWith(TARGET));
  if (!target) throw new Error("migration under test not found");
  for (const m of migrations.filter((n) => n.split("_")[0] < TARGET)) await postgres.applySqlFile(`supabase/migrations/${m}`, m);

  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNER}','booking-dlr@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled,booking_confirmation_sms_enabled) values('${SALON}','${OWNER}','Booking DLR','booking-dlr',true,true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) select e, '${SALON}', 'Radnik' from unnest(array['${EMPLOYEES.join("','")}']::uuid[]) e;
    insert into public.employee_services(salon_id,employee_id,service_id) select '${SALON}', e, '${SERVICE}' from unnest(array['${EMPLOYEES.join("','")}']::uuid[]) e;
  `, "fixture");
  const reminderMd5 = () => postgres.sql(`select string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
    where p.pronamespace='public'::regnamespace and (p.proname like '%reminder%' or p.proname = 'apply_infobip_sms_delivery_report' or p.proname like 'reserve_public_booking_confirmation%')`, "md5");
  // A reminder delivery with a known messageId, for the regression check.
  const pre = await confirmation({ messageId: "pre-058-msg" });
  await postgres.sql(`insert into public.appointment_reminder_deliveries(salon_id,appointment_id,client_id,channel,scheduled_for,appointment_start_snapshot,salon_timezone_snapshot,status,provider,provider_message_id,sent_at,attempt_count,claimed_at,quota_period_start)
    select salon_id, id, client_id, 'sms', start_time - interval '24 hours', start_time, 'Europe/Belgrade', 'sent', 'infobip', 'reminder-msg-1', now(), 1, now(), date_trunc('month', now()) from public.appointments where id='${pre.id}'`, "reminder fixture");
  const before = await reminderMd5();
  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 0. Reminder functions and the reservation are unchanged; new objects are private; existing rows get no delivery data.
  assert(await reminderMd5() === before, "reminder report/claim functions and the reservation function must be unchanged");
  assert(await state(pre.id) === "accepted|-|-|-|-|-", "existing confirmation row unchanged (send outcome kept, no delivery status yet)");
  const acl = await postgres.sql(`select string_agg(r||'='||has_function_privilege(r,'public.apply_confirmation_sms_delivery_report_v1(text,integer,text,text,text,text,boolean,timestamptz,timestamptz)','execute')::text, ',' order by r)
    || ';' || string_agg(r||'='||has_table_privilege(r,'public.infobip_early_delivery_reports','select,insert,update,delete')::text, ',' order by r) from unnest(array['anon','authenticated','service_role']) r`, "acl");
  assert(acl === "anon=false,authenticated=false,service_role=true;anon=false,authenticated=false,service_role=false", `grants ${acl}`);

  // 1. Reminder regression: a reminder messageId is still handled by the reminder function.
  assert(await postgres.sql(`select public.apply_infobip_sms_delivery_report('reminder-msg-1', 5, 'DELIVERED', 'DELIVERED_TO_HANDSET', null, null, null, '${T(-1)}'::timestamptz, now())`, "reminder dlr") === "updated"
    && await postgres.sql(`select status from public.appointment_reminder_deliveries where provider_message_id='reminder-msg-1'`, "reminder status") === "delivered", "reminder report applied as before");
  assert(await postgres.sql(`select public.apply_infobip_sms_delivery_report('${pre.messageId}', 5, 'DELIVERED', null, null, null, null, null, now())`, "reminder unknown") === "ignored_unknown_message",
    "a confirmation messageId is unknown to the reminder function (the webhook then asks the confirmation function)");

  // 2. Delivered: send outcome stays accepted, delivery becomes delivered.
  const a = await confirmation();
  assert(await report(a.messageId, "DELIVERED", { statusId: 5, name: "DELIVERED_TO_HANDSET", errorCode: "0", errorName: "NO_ERROR", permanent: false, doneAt: T(-2) }) === "updated", "delivered applied");
  assert((await state(a.id)).startsWith("accepted|delivered|DELIVERED_TO_HANDSET|0|false|"), `delivered state ${await state(a.id)}`);

  // 3. Duplicate: no change at all.
  const printA = await rowPrint(a.id);
  assert(await report(a.messageId, "DELIVERED", { statusId: 5, name: "DELIVERED_TO_HANDSET", errorCode: "0", errorName: "NO_ERROR", permanent: false, doneAt: (await postgres.sql(`select delivery_done_at from public.public_booking_confirmation_sms where appointment_id='${a.id}'`, "done")) }) === "ignored_duplicate"
    && await rowPrint(a.id) === printA, "duplicate report changes nothing");

  // 4. Late pending after delivered: undated -> stale; dated later -> monotone. Row unchanged.
  assert(await report(a.messageId, "PENDING", { statusId: 7, name: "PENDING_ENROUTE" }) === "ignored_stale" && await rowPrint(a.id) === printA, "late undated PENDING ignored as stale");
  assert(await report(a.messageId, "PENDING", { statusId: 7, name: "PENDING_ENROUTE", doneAt: T(5) }) === "ignored_monotone" && await rowPrint(a.id) === printA, "PENDING never overwrites DELIVERED");
  assert(await report(a.messageId, "UNDELIVERABLE", { name: "UNDELIVERABLE_NOT_DELIVERED", doneAt: T(-10) }) === "ignored_stale" && await rowPrint(a.id) === printA, "older final report after a newer one is stale");

  // 5. Final failure with error details.
  const b = await confirmation();
  assert(await report(b.messageId, "UNDELIVERABLE", { statusId: 9, name: "UNDELIVERABLE_NOT_DELIVERED", errorCode: "34", errorName: "EC_ABSENT_SUBSCRIBER", permanent: false, doneAt: T(-1) }) === "updated"
    && (await state(b.id)).startsWith("accepted|failed|UNDELIVERABLE_NOT_DELIVERED|34|false|"), `failed state ${await state(b.id)}`);
  assert(await report(b.messageId, "PENDING", { name: "PENDING_ENROUTE", doneAt: T(3) }) === "ignored_monotone", "failed never goes back to pending");
  for (const group of ["EXPIRED", "REJECTED"]) {
    const x = await confirmation();
    assert(await report(x.messageId, group, { name: `${group}_X`, doneAt: T(-1) }) === "updated" && (await state(x.id)).startsWith("accepted|failed|"), `${group} is a final failure`);
  }

  // 6. Pending, then delivered.
  const c = await confirmation();
  assert(await report(c.messageId, "PENDING", { statusId: 7, name: "PENDING_ENROUTE" }) === "updated" && (await state(c.id)).startsWith("accepted|pending|PENDING_ENROUTE"), "pending recorded as pending");
  assert(await report(c.messageId, "DELIVERED", { statusId: 5, name: "DELIVERED_TO_HANDSET", doneAt: T(-1) }) === "updated" && (await state(c.id)).startsWith("accepted|delivered|"), "then delivered");

  // 6b. An unknown status group never marks the message delivered or failed, and never replaces a final status.
  const u = await confirmation();
  assert(await report(u.messageId, "ACCEPTED", { name: "SOMETHING_NEW" }) === "updated" && (await state(u.id)).startsWith("accepted|pending|SOMETHING_NEW"), "unknown group -> pending only");
  assert(await report(u.messageId, "BOGUS", { name: "X", doneAt: T(-3) }) === "updated" && (await state(u.id)).startsWith("accepted|pending|X"), "another unknown group stays pending");
  const printDelivered = async (x) => { await report(x.messageId, "DELIVERED", { name: "DELIVERED_TO_HANDSET", doneAt: T(-2) }); return rowPrint(x.id); };
  const ud = await confirmation(); const udPrint = await printDelivered(ud);
  assert(await report(ud.messageId, "WHATEVER", { name: "X", doneAt: T(4) }) === "ignored_monotone" && await rowPrint(ud.id) === udPrint, "unknown group never overwrites delivered");
  const uf = await confirmation();
  await report(uf.messageId, "REJECTED", { name: "REJECTED_X", doneAt: T(-2) });
  const ufPrint = await rowPrint(uf.id);
  assert(await report(uf.messageId, "WHATEVER", { name: "X", doneAt: T(4) }) === "ignored_monotone" && await rowPrint(uf.id) === ufPrint, "unknown group never overwrites failed");
  await report("early-unknown-group", "DELIVERED", { name: "DELIVERED_TO_HANDSET", doneAt: T(-1) });
  await report("early-unknown-group", "WHATEVER", { name: "X", doneAt: T(4) });
  assert(await early("early-unknown-group") === "DELIVERED|DELIVERED_TO_HANDSET", "unknown group does not replace a kept final report");

  // 7. Unknown id: deferred, kept briefly, nothing else changes; expired early reports are purged.
  const counts = () => postgres.sql(`select (select md5(string_agg(t::text,'' order by appointment_id)) from public.public_booking_confirmation_sms t)||'|'||(select md5(string_agg(d::text,'' order by id)) from public.appointment_reminder_deliveries d)`, "counts");
  const beforeUnknown = await counts();
  assert(await report("never-sent-id", "DELIVERED", { doneAt: T(-1) }) === "deferred_unknown_message" && await counts() === beforeUnknown && await early("never-sent-id") === "DELIVERED|-", "unknown id deferred without touching rows");
  await postgres.sql(`update public.infobip_early_delivery_reports set received_at = now() - interval '3 days' where provider_message_id='never-sent-id'`, "age");
  // Lazy cleanup: a report for a known id does not purge; only the next unmatched report does (no scheduled job).
  const known = await confirmation();
  await report(known.messageId, "PENDING", { name: "PENDING_ENROUTE" });
  assert(await early("never-sent-id") === "DELIVERED|-", "a report for a known id leaves old unmatched rows in place (cleanup is not scheduled)");
  await report("another-unknown", "PENDING");
  assert(await early("never-sent-id") === "none", "early reports older than 2 days are purged");
  // Early precedence: final beats a late pending.
  await report("early-order", "DELIVERED", { name: "DELIVERED_TO_HANDSET", doneAt: T(-1) });
  await report("early-order", "PENDING", { name: "PENDING_ENROUTE" });
  assert(await early("early-order") === "DELIVERED|DELIVERED_TO_HANDSET", "a late pending does not replace a kept final report");

  // 8. Report before the messageId is written: applied when finish writes it.
  const d = await confirmation({ finish: false });
  const dMessage = `msg-${randomUUID()}`;
  assert(await state(d.id) === "sending|-|-|-|-|-", "send in progress");
  assert(await report(dMessage, "DELIVERED", { statusId: 5, name: "DELIVERED_TO_HANDSET", doneAt: T(-1) }) === "deferred_unknown_message", "report before messageId is deferred");
  assert(await finishSms(d.id, dMessage) === "t" && (await state(d.id)).startsWith("accepted|delivered|DELIVERED_TO_HANDSET") && await early(dMessage) === "none", "finish applies the early report and clears it");

  // 9. Same race, concurrently: finish and report in parallel, 20 times; the report is never lost.
  for (let i = 0; i < 20; i += 1) {
    const r = await confirmation({ finish: false });
    const message = `race-${i}-${randomUUID()}`;
    const outcomes = await Promise.all([finishSms(r.id, message), report(message, i % 2 ? "UNDELIVERABLE" : "DELIVERED", { name: "X", doneAt: T(-1) })]);
    const s = await state(r.id);
    assert(s.startsWith(`accepted|${i % 2 ? "failed" : "delivered"}|X`) && await early(message) === "none", `race ${i}: ${outcomes.join(",")} -> ${s}`);
  }

  // 10. Invalid input is rejected.
  let invalid = "fulfilled";
  try { await report(a.messageId, ""); } catch (error) { invalid = error.message; }
  assert(invalid.includes("INVALID_DELIVERY_REPORT_INPUT"), "empty status group rejected");

  console.log("Confirmation SMS delivery report test passed (reminder functions and rows unchanged, private grants, delivered/failed/pending kept apart from the send outcome, duplicate, stale and monotone ordering, unknown ids deferred and purged, report-before-messageId applied on finish, 20 concurrent finish/report races, invalid input).");
} finally {
  postgres.cleanup();
}

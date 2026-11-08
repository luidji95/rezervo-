import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Salon-managed SMS (migration 202611080060) on a disposable PostgreSQL container only (--network none) — never the
// persistent local database or a remote project. Checks the carry-over of existing settings, the main switch and the
// reminder option for confirmations and reminders, cancellation and rescheduling, replays and parallel requests, the
// plan's SMS right, salon isolation, RLS, the unchanged limits and grants. Nothing is sent: confirmations stop at the
// database reservation and reminders at the pre-send validation (the provider is never called here).
const TARGET = "202611080060";
const id = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNERS = [1, 2, 3, 4, 5, 6].map((n) => id("f6000000", n));
const SALONS = [1, 2, 3, 4, 5, 6].map((n) => id("f6100000", n));
const SLUGS = ["sms-both", "sms-reminders-only", "sms-confirm-only", "sms-none", "sms-new", "sms-starter"];
const SERVICES = SALONS.map((_, i) => id("f6200000", i + 1));
const EMPLOYEES = SALONS.map((_, i) => id("f6300000", i + 1));
const postgres = createDisposableSupabasePostgres("rezervo-salon-sms-settings");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const recipient = () => randomBytes(32).toString("hex");
let slot = 0;
// Public booking with a private link, start in 2 days (reserve requires a fresh confirmed public booking).
const book = async (salonIndex, { phone } = {}) => {
  slot += 1;
  const start = `date_trunc('day', now()) + interval '2 days' + make_interval(mins => ${slot} * 30)`;
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  return postgres.sql(`select appointment_id from public.create_public_booking_with_manage_token_v1(${quote(SLUGS[salonIndex])},'${SERVICES[salonIndex]}','${EMPLOYEES[salonIndex]}',${start},'Klijent',${quote(phone ?? `0641${String(slot).padStart(6, "0")}`)},'','${randomUUID()}','${hash}')`, "book");
};
const reserve = (appointmentId, hash = recipient()) => postgres.sql(`select public.reserve_public_booking_confirmation_sms_v2('${appointmentId}', '${hash}')`, "reserve v2");
const settings = (salonIndex, { sms, reminder, hours = 24 }) => postgres.sql(`insert into public.salon_reminder_settings(salon_id,sms_notifications_enabled,enabled,channel,hours_before)
  values('${SALONS[salonIndex]}',${sms},${reminder},'sms',${hours})
  on conflict (salon_id) do update set sms_notifications_enabled=excluded.sms_notifications_enabled, enabled=excluded.enabled, hours_before=excluded.hours_before`, "owner saves settings (service role upsert, as the API)");
const startOf = (appointmentId) => postgres.sql(`select start_time from public.appointments where id='${appointmentId}'`, "start");
// Claim at a given moment relative to the appointment start (minutes after "start - hours").
const claimAt = (whenSql) => postgres.sql(`select coalesce(string_agg(appointment_id::text, ','), '') from public.claim_due_appointment_reminders(50, ${whenSql}, 10)`, "claim");
const deliveries = (appointmentId) => postgres.sql(`select coalesce(string_agg(status||':'||coalesce(last_error_code,''), ',' order by created_at), '') from public.appointment_reminder_deliveries where appointment_id='${appointmentId}'`, "deliveries");
const validate = (appointmentId, whenSql) => postgres.sql(`select v.reason from public.appointment_reminder_deliveries d
  cross join lateral public.validate_claimed_reminder_for_send(d.id, d.claim_token, ${whenSql}) v
  where d.appointment_id='${appointmentId}' and d.status='processing'`, "validate");
// Runs a claim at the given moment and reports whether the appointment still has no reminder delivery.
const noReminder = async (appointmentId, whenSql) => { await claimAt(whenSql); return await deliveries(appointmentId) === ""; };
const due = (appointmentId, hours = 24, plusMinutes = 1) => `(select start_time - make_interval(hours => ${hours}) + make_interval(mins => ${plusMinutes}) from public.appointments where id='${appointmentId}')`;

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

  // Fixtures before the migration: 6 salons on the automatic Pro trial; salon 5 is created later ("new salon").
  const fixture = (indexes) => indexes.map((i) => `
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNERS[i]}','sms-${i}@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled) values('${SALONS[i]}','${OWNERS[i]}','SMS ${i}','${SLUGS[i]}',true,true);
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICES[i]}','${SALONS[i]}','Sisanje',30,1000);
    insert into public.employees(id,salon_id,full_name) values('${EMPLOYEES[i]}','${SALONS[i]}','Radnik');
    insert into public.employee_services(salon_id,employee_id,service_id) values('${SALONS[i]}','${EMPLOYEES[i]}','${SERVICES[i]}');`).join("\n");
  await postgres.sql(`${fixture([0, 1, 2, 3, 5])}
    update public.subscriptions set plan_id=(select id from public.plans where slug='starter') where salon_id='${SALONS[5]}';
    -- Existing state: salon 0 had the operator switch and reminders, salon 1 reminders only, salon 2 the operator
    -- switch only (no settings row), salon 3 nothing, salon 5 (Starter) the operator switch.
    update public.salons set booking_confirmation_sms_enabled=true where id in ('${SALONS[0]}','${SALONS[2]}','${SALONS[5]}');
    insert into public.salon_reminder_settings(salon_id,enabled,channel,hours_before) values('${SALONS[0]}',true,'sms',12),('${SALONS[1]}',true,'sms',2);`, "fixtures before 060");
  const md5 = () => postgres.sql(`select string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
    where p.pronamespace='public'::regnamespace and (p.proname like 'create_public_booking%' or p.proname like '%manage_token%' or p.proname like '%cancel%'
      or p.proname in ('reserve_public_booking_confirmation_sms_v1','finish_public_booking_confirmation_sms_v1','get_salon_reminder_usage','reminder_usage_period')
      or p.proname like '%delivery_report%')`, "md5");
  const before = await md5();
  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 0. Additive: booking, cancellation, manage-link, v1/finish, usage and DLR functions unchanged; v2 for service role only.
  assert(await md5() === before, "unrelated functions must be unchanged");
  const acl = await postgres.sql(`select string_agg(r||'='||has_function_privilege(r,'public.reserve_public_booking_confirmation_sms_v2(uuid,text)','execute')::text, ',') from unnest(array['anon','authenticated','service_role']) r`, "acl");
  assert(acl === "anon=false,authenticated=false,service_role=true", `v2 grants ${acl}`);
  for (const fn of ["claim_due_appointment_reminders(integer,timestamp with time zone,integer)", "validate_claimed_reminder_for_send(uuid,uuid,timestamp with time zone)"]) {
    const grants = await postgres.sql(`select string_agg(r||'='||has_function_privilege(r,'public.${fn}','execute')::text, ',') from unnest(array['anon','authenticated']) r`, "reminder acl");
    assert(grants === "anon=false,authenticated=false", `${fn} stays service-only: ${grants}`);
  }

  // 1. Carry-over without new sending.
  const carried = await postgres.sql(`select string_agg(s.slug||'='||coalesce(r.sms_notifications_enabled::text,'-')||'/'||coalesce(r.enabled::text,'-')||'/'||coalesce(r.hours_before::text,'-'), ',' order by s.slug)
    from public.salons s left join public.salon_reminder_settings r on r.salon_id=s.id`, "carry-over");
  assert(carried === "sms-both=true/true/12,sms-confirm-only=true/false/24,sms-none=-/-/-,sms-reminders-only=false/true/2,sms-starter=true/false/24", `carry-over ${carried}`);

  // 2. New salon after the release: no row, everything off, owner can set it without operator SQL.
  await postgres.sql(fixture([4]), "new salon");
  const fresh = await book(4);
  assert(await reserve(fresh) === "salon_disabled", "new salon: confirmation off by default");
  assert(await postgres.sql(`select count(*) from public.salon_reminder_settings where salon_id='${SALONS[4]}'`, "no row") === "0", "new salon has no settings row");
  assert(await noReminder(fresh, due(fresh)), "new salon: no reminder");

  // 3. Both off (explicit row) -> no messages.
  await settings(4, { sms: false, reminder: false });
  const off = await book(4);
  assert(await reserve(off) === "salon_disabled" && await noReminder(off, due(off)), "both off: nothing");
  // Reminder option on but main switch off -> still nothing.
  await settings(4, { sms: false, reminder: true });
  const mainOff = await book(4);
  assert(await reserve(mainOff) === "salon_disabled" && await noReminder(mainOff, due(mainOff)), "reminder without main switch: nothing");

  // 4. Main on, reminder off -> exactly one confirmation, no reminder; replay and parallel requests do not duplicate.
  await settings(4, { sms: true, reminder: false });
  const confirmOnly = await book(4);
  const hash = recipient();
  const burst = await Promise.all(Array.from({ length: 6 }, () => reserve(confirmOnly, hash)));
  assert(burst.filter((o) => o === "reserved").length === 1 && burst.filter((o) => o === "already_reserved").length === 5, `parallel reserve ${burst}`);
  assert(await reserve(confirmOnly, hash) === "already_reserved", "replay: already reserved");
  assert(await postgres.sql(`select count(*) from public.public_booking_confirmation_sms where appointment_id='${confirmOnly}'`, "one row") === "1", "one confirmation row");
  assert(await noReminder(confirmOnly, due(confirmOnly)), "main on, reminder off: no reminder");

  // 5. Both on -> confirmation and a reminder at the configured time (not earlier).
  await settings(4, { sms: true, reminder: true, hours: 6 });
  const both = await book(4);
  assert(await reserve(both) === "reserved", "both on: confirmation reserved");
  assert(await noReminder(both, due(both, 6, -1)), "reminder not claimed before its time");
  await claimAt(due(both, 6, 1));
  assert(await deliveries(both) === "processing:", "reminder claimed at its time");
  assert(await validate(both, due(both, 6, 2)) === "ELIGIBLE", "pre-send validation passes");
  assert(await postgres.sql(`select (scheduled_for = start_time - interval '6 hours')::text from public.appointment_reminder_deliveries d join public.appointments a on a.id=d.appointment_id where d.appointment_id='${both}'`, "time") === "true", "scheduled 6 h before");
  // A second claim run does not create a second reminder for the same appointment and time.
  await claimAt(due(both, 6, 3));
  assert(await postgres.sql(`select count(*) from public.appointment_reminder_deliveries where appointment_id='${both}'`, "one reminder") === "1", "one reminder per appointment");

  // 6. Switching off before sending stops a claimed reminder (checked right before sending) and a scheduled retry.
  const stopClaimed = await book(4);
  await claimAt(due(stopClaimed, 6, 1));
  await settings(4, { sms: false, reminder: true, hours: 6 });
  assert(await validate(stopClaimed, due(stopClaimed, 6, 2)) === "REMINDERS_DISABLED", "main switch off -> claimed reminder not sent");
  assert(await deliveries(stopClaimed) === "cancelled:REMINDERS_DISABLED", `cancelled: ${await deliveries(stopClaimed)}`);
  await settings(4, { sms: true, reminder: true, hours: 6 });
  const stopRetry = await book(4);
  await claimAt(due(stopRetry, 6, 1));
  await postgres.sql(`update public.appointment_reminder_deliveries set status='retry_scheduled', lease_expires_at=null, claim_token=null, next_retry_at=now()+interval '10 years' where appointment_id='${stopRetry}'`, "retry scheduled");
  await settings(4, { sms: true, reminder: false, hours: 6 });
  await claimAt(due(stopRetry, 6, 5));
  assert(await deliveries(stopRetry) === "cancelled:SCHEDULE_INVALIDATED", `reminder option off -> retry invalidated: ${await deliveries(stopRetry)}`);
  await settings(4, { sms: true, reminder: true, hours: 6 });

  // 7. Cancellation and rescheduling.
  const cancelled = await book(4);
  await postgres.sql(`update public.appointments set status='cancelled', cancelled_at=now() where id='${cancelled}'`, "cancel");
  assert(await noReminder(cancelled, due(cancelled, 6, 1)), "cancelled appointment gets no reminder");
  const cancelledAfterClaim = await book(4);
  await claimAt(due(cancelledAfterClaim, 6, 1));
  await postgres.sql(`update public.appointments set status='cancelled', cancelled_at=now() where id='${cancelledAfterClaim}'`, "cancel after claim");
  assert(await validate(cancelledAfterClaim, due(cancelledAfterClaim, 6, 2)) === "APPOINTMENT_CANCELLED", "cancelled after claim -> not sent");
  const moved = await book(4);
  const oldStart = await startOf(moved);
  await claimAt(due(moved, 6, 1));
  await postgres.sql(`update public.appointments set start_time=start_time+interval '1 day', end_time=end_time+interval '1 day' where id='${moved}'`, "reschedule");
  assert(await validate(moved, `'${oldStart}'::timestamptz - interval '6 hours' + interval '2 minutes'`) === "APPOINTMENT_RESCHEDULED", "moved after claim -> old reminder not sent");
  await claimAt(due(moved, 6, 1));
  assert(await deliveries(moved) === "cancelled:APPOINTMENT_RESCHEDULED,processing:", `moved: old cancelled, new reminder at the new time: ${await deliveries(moved)}`);

  // 8. Plan right and isolation: Starter with the main switch on gets nothing; other salons are unaffected.
  const starter = await book(5);
  assert(await reserve(starter) === "not_entitled", "Starter: confirmation not entitled");
  await settings(5, { sms: true, reminder: true, hours: 6 });
  assert(await noReminder(starter, due(starter, 6, 1)), "Starter: no reminder");
  const none = await book(3);
  assert(await reserve(none) === "salon_disabled" && await noReminder(none, due(none, 24, 1)), "salon without settings unaffected by others");
  const carriedBoth = await book(0);
  assert(await reserve(carriedBoth) === "reserved", "carried-over salon keeps confirmations");
  const remindersOnly = await book(1);
  assert(await reserve(remindersOnly) === "salon_disabled" && await noReminder(remindersOnly, due(remindersOnly, 2, 1)), "reminders-only salon: main switch off, nothing new and no reminder");
  // Losing access stops both (trial ended -> read-only).
  const beforeExpiry = await book(0);
  await postgres.sql(`update public.subscriptions set trial_ends_at=now()-interval '1 day' where salon_id='${SALONS[0]}'`, "trial ended");
  assert(await reserve(beforeExpiry) === "not_entitled", "no confirmation without full access");
  await claimAt(due(beforeExpiry, 12, 1));
  assert(await deliveries(beforeExpiry) === "", "no reminder without full access");

  // 9. RLS: an owner reads only the own row and cannot write; another owner sees nothing of it.
  const rls = (owner, statement) => postgres.sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${owner}', true);
    ${statement}; rollback;`, "rls").then((out) => out.trim().split(String.fromCharCode(10)).pop().trim());
  assert(await rls(OWNERS[4], `select count(*) from public.salon_reminder_settings`) === "1", "owner reads own settings only");
  assert(await rls(OWNERS[3], `select count(*) from public.salon_reminder_settings where salon_id='${SALONS[4]}'`) === "0", "other owner cannot read");
  let writeError = "";
  try { await rls(OWNERS[4], `update public.salon_reminder_settings set sms_notifications_enabled=false where salon_id='${SALONS[4]}'`); } catch (error) { writeError = error.message; }
  assert(/permission denied/.test(writeError), `owner cannot write directly: ${writeError}`);

  // 10. Limits unchanged: 1 per recipient per 10 minutes, 20 per salon per 24 hours.
  const sameRecipient = recipient();
  assert(await reserve(await book(4), sameRecipient) === "reserved" && await reserve(await book(4), sameRecipient) === "recipient_limit", "recipient limit");
  const used = Number(await postgres.sql(`select count(*) from public.public_booking_confirmation_sms where salon_id='${SALONS[4]}' and created_at > now() - interval '24 hours'`, "used"));
  for (let i = used; i < 20; i += 1) assert(await reserve(await book(4)) === "reserved", `fill ${i}`);
  assert(await reserve(await book(4)) === "salon_limit", "21st in 24 h -> salon_limit");

  console.log("Salon SMS settings contract passed: carry-over, switches, reminder timing, stop before send, cancel/reschedule, replay/parallel, plan right, isolation, RLS, limits, grants.");
} finally {
  postgres.cleanup();
}

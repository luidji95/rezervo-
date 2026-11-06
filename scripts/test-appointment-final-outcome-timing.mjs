import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// completed/no_show only from the scheduled end_time (migration 202611060052), on a disposable PostgreSQL container
// only — never the persistent local database or a remote project. Every case runs in its own transaction that moves
// the appointment relative to that transaction's now(), calls the real status gateway, records the outcome and rolls
// back, so the boundary (end_time = now()) is exact and cases never overlap each other.
const SALON = "e2000000-0000-4000-8000-000000000052";
const OWNER = "e1000000-0000-4000-8000-000000000052";
const MANAGER = "e1000000-0000-4000-8000-000000000053";
const STAFF = "e1000000-0000-4000-8000-000000000054";
const SERVICE = "e3000000-0000-4000-8000-000000000052";
const EMPLOYEE = "e4000000-0000-4000-8000-000000000052";
const postgres = createDisposableSupabasePostgres("rezervo-final-outcome-timing");

const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await postgres.initialize();
  await postgres.sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
      ('${OWNER}','fo-owner@example.invalid','{}','{}'),('${MANAGER}','fo-manager@example.invalid','{}','{}'),('${STAFF}','fo-staff@example.invalid','{}','{}');
    insert into public.profiles(id,full_name,email) values('${OWNER}','Owner','fo-owner@example.invalid'),
      ('${MANAGER}','Manager','fo-manager@example.invalid'),('${STAFF}','Staff','fo-staff@example.invalid') on conflict (id) do nothing;
    insert into public.salons(id,owner_id,name,slug,booking_enabled,online_booking_enabled) values('${SALON}','${OWNER}','Final Outcome','final-outcome',true,true);
    insert into public.salon_members(salon_id,profile_id,role,status)
      select '${SALON}','${OWNER}','owner','active' where not exists (select 1 from public.salon_members where profile_id='${OWNER}');
    insert into public.salon_members(salon_id,profile_id,role,status) values('${SALON}','${MANAGER}','manager','active'),('${SALON}','${STAFF}','employee','active');
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE}','${SALON}','Usluga',30,1000);
    insert into public.employees(id,salon_id,full_name,profile_id) values('${EMPLOYEE}','${SALON}','Staff','${STAFF}');
    insert into public.employee_services(salon_id,employee_id,service_id) values('${SALON}','${EMPLOYEE}','${SERVICE}');

    create schema fo_test;
    create table fo_test.appt(label text primary key, id uuid not null);
    grant usage on schema fo_test to authenticated, service_role; grant all on fo_test.appt to authenticated, service_role;
    -- Runs p_sql as an authenticated user (owner/manager gateway) or as service_role (employee route); returns ok or the error.
    create function fo_test.call(p_kind text, p_sql text) returns text language plpgsql as $$
    begin
      if p_kind = 'employee' then perform set_config('role', 'service_role', true);
      else perform set_config('request.jwt.claim.sub', case p_kind when 'owner' then '${OWNER}' else '${MANAGER}' end, true);
           perform set_config('role', 'authenticated', true); end if;
      execute p_sql; perform set_config('role', 'none', true); return 'ok';
    exception when others then perform set_config('role', 'none', true); return sqlerrm; end $$;
    create function fo_test.set_status(p_kind text, p_id uuid, p_status text) returns text language sql as $$
      select fo_test.call(p_kind, case when p_kind = 'employee'
        then format('select * from public.update_employee_appointment_status(%L,%L,%L)', p_id, '${STAFF}', p_status)
        else format('select * from public.update_owner_appointment_status_v1(%L,%L)', p_id, p_status) end) $$;
    -- Moves the appointment so that end_time = now() + p_end_offset, calls the gateway and reports
    -- result|status|completed_at set|completed revenue|still occupies the slot.
    create function fo_test.attempt(p_kind text, p_label text, p_status text, p_end_offset interval) returns text language plpgsql as $$
    declare v_id uuid; v_result text; v_occupied text;
    begin
      select id into v_id from fo_test.appt where label = p_label;
      update public.appointments set start_time = now() + p_end_offset - interval '30 minutes', end_time = now() + p_end_offset where id = v_id;
      v_result := fo_test.set_status(p_kind, v_id, p_status);
      begin
        insert into public.appointments(salon_id,client_id,employee_id,primary_service_id,start_time,end_time,duration_minutes,price,status,booking_source)
          select salon_id,client_id,employee_id,primary_service_id,start_time,end_time,30,0,'pending','manual' from public.appointments where id = v_id;
        v_occupied := 'free';
        raise exception 'undo probe';
      exception when exclusion_violation then v_occupied := 'occupied';
                when raise_exception then null; end;
      return v_result || '|' || (select status::text || '|' || (completed_at is not null)::text from public.appointments where id = v_id)
        || '|' || (select coalesce(sum(price), 0)::int from public.appointments where salon_id = '${SALON}' and status = 'completed') || '|' || v_occupied;
    end $$;
  `, "fixture");

  // One appointment per case label, each on its own future hour; owner/manager cases start confirmed, employee too.
  const labels = [];
  for (const kind of ["owner", "manager", "employee"]) for (const status of ["completed", "no_show"]) for (const when of ["before", "boundary", "after", "future"]) labels.push(`${kind}:${status}:${when}`);
  labels.push("owner:pending-no_show", "employee:pending-completed", "owner:cancel-future", "employee:cancel-future", "owner:pending-completed-future", "owner:pending-completed-after");
  const make = labels.map((label, index) => `
    with created as (select appointment_id from public.create_owner_appointment_atomic_v1('${SALON}','${SERVICE}','${EMPLOYEE}',
      date_trunc('day', now()) + interval '3 days' + make_interval(hours => ${index}), 'Klijent ${index}', '+3816000${String(index).padStart(4, "0")}', '', '', gen_random_uuid()))
    insert into fo_test.appt select '${label}', appointment_id from created;`).join("\n");
  await postgres.sql(`begin; select set_config('request.jwt.claim.sub','${OWNER}',true); set local role authenticated; ${make} commit;`, "appointments");
  await postgres.sql(`select fo_test.set_status('owner', id, 'confirmed') from fo_test.appt where label not like '%pending%'`, "confirm");
  assert(await postgres.sql(`select count(*) from public.appointments a join fo_test.appt t on t.id = a.id where a.status = 'confirmed'`, "confirmed") === String(labels.filter((label) => !label.includes("pending")).length),
    "fixture appointments must be confirmed");
  const revenueBefore = await postgres.sql(`select coalesce(sum(price),0)::int from public.appointments where salon_id='${SALON}' and status='completed'`, "revenue");
  assert(revenueBefore === "0", "no completed revenue before the cases");

  const offsets = { before: "1 second", boundary: "0 seconds", after: "-1 minute", future: "2 days" };
  const run = async (kind, label, status, offset) => (await postgres.sql(`begin; select fo_test.attempt('${kind}','${label}','${status}','${offset}'); rollback;`, label))
    .split(/\r?\n/).filter(Boolean).at(-1);
  const results = [];
  for (const kind of ["owner", "manager", "employee"]) for (const status of ["completed", "no_show"]) for (const when of Object.keys(offsets)) {
    const outcome = await run(kind, `${kind}:${status}:${when}`, status, offsets[when]);
    const allowed = when === "boundary" || when === "after";
    // The employee gateway never sets completed_at (pre-existing, unchanged here).
    // Allowed completed adds this appointment's price and frees the overlap constraint (existing behaviour);
    // a refusal keeps confirmed, no completed_at, no revenue and the slot occupied.
    const expected = allowed
      ? `ok|${status}|${status === "completed" && kind !== "employee"}|${status === "completed" ? 1000 : 0}|free`
      : "APPOINTMENT_NOT_ENDED|confirmed|false|0|occupied";
    assert(outcome === expected, `${kind} ${status} ${when}: expected ${expected}, got ${outcome}`);
    results.push(`${kind} ${status} ${when}`);
  }

  // Transition rules keep precedence over the time check and are otherwise unchanged.
  assert((await run("owner", "owner:pending-no_show", "no_show", offsets.before)).startsWith("INVALID_STATUS_TRANSITION|pending"), "owner pending -> no_show stays INVALID_STATUS_TRANSITION");
  assert((await run("employee", "employee:pending-completed", "completed", offsets.before)).startsWith("INVALID_STATUS_TRANSITION|pending"), "employee pending -> completed stays INVALID_STATUS_TRANSITION");
  assert((await run("owner", "owner:pending-completed-future", "completed", offsets.future)) === "APPOINTMENT_NOT_ENDED|pending|false|0|occupied", "owner pending -> completed before end is refused");
  assert((await run("owner", "owner:pending-completed-after", "completed", offsets.after)) === "ok|completed|true|1000|free", "owner pending -> completed after end is allowed");
  // Cancel is not time-gated, for either role.
  assert((await run("owner", "owner:cancel-future", "cancelled", offsets.future)).startsWith("ok|cancelled"), "owner can still cancel a future appointment");
  assert((await run("employee", "employee:cancel-future", "cancelled", offsets.future)).startsWith("ok|cancelled"), "employee can still cancel a future appointment");

  // Everything above was rolled back: statuses, completed_at and revenue are untouched.
  const state = await postgres.sql(`select string_agg(distinct a.status::text collate "C", ',' order by a.status::text collate "C")||'|'||count(*) filter (where a.completed_at is not null)
    from public.appointments a join fo_test.appt t on t.id = a.id`, "state");
  assert(state === "confirmed,pending|0", `rolled back cases must leave no trace, got ${state}`);

  // A refused committed call (not rolled back by the test) also leaves the row unchanged.
  const committed = await postgres.sql(`select fo_test.set_status('manager', id, 'completed') from fo_test.appt where label = 'manager:completed:future'`, "committed refusal");
  assert(committed === "APPOINTMENT_NOT_ENDED", `committed refusal must be APPOINTMENT_NOT_ENDED, got ${committed}`);
  assert((await postgres.sql(`select status||'|'||(completed_at is null) from public.appointments a join fo_test.appt t on t.id=a.id where t.label='manager:completed:future'`, "after refusal"))
    .startsWith("confirmed|true"), "refused call must not change status or completed_at");

  // Grants and function settings are unchanged.
  const acl = await postgres.sql(`select
    has_function_privilege('authenticated','public.update_owner_appointment_status_v1(uuid,public.appointment_status,text)','execute')::text||'|'||
    has_function_privilege('anon','public.update_owner_appointment_status_v1(uuid,public.appointment_status,text)','execute')::text||'|'||
    has_function_privilege('service_role','public.update_employee_appointment_status(uuid,uuid,public.appointment_status)','execute')::text||'|'||
    has_function_privilege('authenticated','public.update_employee_appointment_status(uuid,uuid,public.appointment_status)','execute')::text||'|'||
    has_function_privilege('anon','public.update_employee_appointment_status(uuid,uuid,public.appointment_status)','execute')::text||'|'||
    (select string_agg(prosecdef::text||':'||array_to_string(proconfig, ','), ',' order by proname) from pg_proc
      where proname in ('update_owner_appointment_status_v1','update_employee_appointment_status') and pronamespace='public'::regnamespace)`, "acl");
  assert(acl === `true|false|true|false|false|true:search_path="",true:search_path=""`, `unexpected grants/config ${acl}`);

  console.log(`Final outcome timing test passed (${results.length} role/status/time cases incl. exact end_time boundary, transition precedence, cancel unaffected, refusal leaves status/revenue/occupancy unchanged, grants).`);
} finally {
  postgres.cleanup();
}

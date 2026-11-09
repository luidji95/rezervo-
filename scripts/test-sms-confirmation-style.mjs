import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// SMS confirmation style and playful service category (migration 202611090061) on a disposable PostgreSQL container
// only — never the persistent local database or a remote project. Checks that existing salons and services stay on
// the standard message, the allowed values, create/update of the category (omitted keeps it, 'universal' clears it,
// old positional and named calls still work), tenant isolation, grants, and that sending, reservation, reminder and
// booking functions are unchanged.
const TARGET = "202611090061";
const OWNER = "f1000000-0000-4000-8000-000000000611";
const OWNER_B = "f1000000-0000-4000-8000-000000000612";
const SALON = "f2000000-0000-4000-8000-000000000611";
const SALON_B = "f2000000-0000-4000-8000-000000000612";
const SERVICE_OLD = "f3000000-0000-4000-8000-000000000611";
const postgres = createDisposableSupabasePostgres("rezervo-sms-confirmation-style");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
// set_config runs in a WHERE that returns no row, so the output is only the statement's result.
const asOwner = (owner, sql) => `begin; set local role authenticated; select 1 where set_config('request.jwt.claim.sub','${owner}',true) is null; ${sql}; commit;`;
const expectError = async (sql, code, label) => {
  try {
    await postgres.sql(sql, label);
  } catch (error) {
    assert(String(error.message).includes(code), `${label}: expected ${code}, got ${error.message}`);
    return;
  }
  throw new Error(`${label}: expected ${code}`);
};

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
    insert into private.billing_runtime_config(singleton, environment) values (true, 'test');
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${OWNER}','style-a@example.invalid','{}','{}'),('${OWNER_B}','style-b@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values('${SALON}','${OWNER}','Style A','style-a'),('${SALON_B}','${OWNER_B}','Style B','style-b');
    update public.subscriptions set status='active',trial_ends_at=null,billing_provider='lemonsqueezy',billing_environment='test',
      provider_customer_id='style-customer-'||salon_id::text,provider_subscription_id='style-subscription-'||salon_id::text,
      current_period_starts_at=now(),current_period_ends_at=now()+interval '30 days',provider_state_updated_at=now()
    where salon_id in ('${SALON}','${SALON_B}');
    insert into public.services(id,salon_id,name,duration_minutes,price) values('${SERVICE_OLD}','${SALON}','Postojeca usluga',30,1000);
    insert into public.salon_reminder_settings(salon_id,enabled,channel,hours_before,sms_notifications_enabled) values('${SALON}',true,'sms',24,true);
  `, "fixture");

  const md5 = () => postgres.sql(`select string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname not in ('create_service_v1','update_service_v1')
      and (p.proname like '%confirmation_sms%' or p.proname like '%reminder%' or p.proname like 'create_public_booking%'
        or p.proname like '%manage_token%' or p.proname like '%service%' or p.proname like 'resolve_salon_access%')`, "md5");
  const before = await md5();
  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 0. Only the two service functions change; sending, reservation, reminders, booking and access are untouched.
  assert(await md5() === before, "other functions must be unchanged");

  // 1. Existing salon and service: no style (standard message), no category (universal); settings unchanged.
  assert(await postgres.sql(`select coalesce(sms_confirmation_style,'null')||','||sms_notifications_enabled||','||enabled from public.salon_reminder_settings where salon_id='${SALON}'`, "settings") === "null,true,true", "existing settings keep the standard message");
  assert(await postgres.sql(`select coalesce(sms_humor_category,'null') from public.services where id='${SERVICE_OLD}'`, "service") === "null", "existing service is universal");

  // 2. Only the listed values are stored.
  await expectError(`update public.salon_reminder_settings set sms_confirmation_style='funny' where salon_id='${SALON}'`, "salon_reminder_settings_sms_confirmation_style_check", "style check");
  await expectError(`update public.services set sms_humor_category='nails' where id='${SERVICE_OLD}'`, "services_sms_humor_category_check", "category check");
  await expectError(`update public.services set sms_humor_category='universal' where id='${SERVICE_OLD}'`, "services_sms_humor_category_check", "universal is stored as null");
  for (const style of ["business", "casual", "playful"]) {
    await postgres.sql(`update public.salon_reminder_settings set sms_confirmation_style='${style}' where salon_id='${SALON}'`, style);
  }

  // 3. Create: category stored when given, 'universal' and omitted are null, unknown values rejected.
  const create = (name, extra) => postgres.sql(asOwner(OWNER, `select (public.create_service_v1('${SALON}','${name}',null,null,30,1000,true,true,0,null,null,null,0${extra})).id`), name);
  const category = (id) => postgres.sql(`select coalesce(sms_humor_category,'null') from public.services where id='${id}'`, "category");
  const haircut = await create("Sisanje", ",'haircut'");
  const universal = await create("Univerzalna", ",'universal'");
  const positional = await create("Stari poziv", "");
  assert(await category(haircut) === "haircut" && await category(universal) === "null" && await category(positional) === "null", "create categories");
  await expectError(asOwner(OWNER, `select public.create_service_v1('${SALON}','Losa',null,null,30,1000,true,true,0,null,null,null,0,'nails')`), "INVALID_INPUT", "create invalid");

  // 4. Update: omitted keeps the category (positional and PostgREST-style named calls), a value replaces it,
  //    'universal' clears it, unknown values are rejected and nothing else is reset.
  const update = (args) => postgres.sql(asOwner(OWNER, `select (public.update_service_v1(${args})).id`), "update");
  await update(`'${haircut}','Sisanje 2',null,null,45,1200,true,true`);
  assert(await category(haircut) === "haircut", "positional update keeps the category");
  await update(`p_service_id=>'${haircut}',p_name=>'Sisanje 3',p_description=>null,p_category_name=>null,p_duration_minutes=>45,p_price=>1200,p_is_active=>true,p_is_public=>true`);
  assert(await category(haircut) === "haircut", "named update without the argument keeps the category");
  await update(`p_service_id=>'${haircut}',p_name=>'Masaza',p_description=>null,p_category_name=>null,p_duration_minutes=>60,p_price=>2000,p_is_active=>true,p_is_public=>true,p_sms_humor_category=>'massage'`);
  assert(await category(haircut) === "massage", "update sets the category");
  await update(`p_service_id=>'${haircut}',p_name=>'Masaza',p_description=>null,p_category_name=>null,p_duration_minutes=>60,p_price=>2000,p_is_active=>true,p_is_public=>true,p_sms_humor_category=>'universal'`);
  assert(await category(haircut) === "null", "universal clears the category");
  assert(await postgres.sql(`select name||','||duration_minutes||','||price::int from public.services where id='${haircut}'`, "fields") === "Masaza,60,2000", "other fields saved");
  await expectError(asOwner(OWNER, `select public.update_service_v1(p_service_id=>'${haircut}',p_name=>'X',p_description=>null,p_category_name=>null,p_duration_minutes=>30,p_price=>1,p_is_active=>true,p_is_public=>true,p_sms_humor_category=>'nails')`), "INVALID_INPUT", "update invalid");

  // 5. Another salon's owner cannot change the category.
  await expectError(asOwner(OWNER_B, `select public.update_service_v1(p_service_id=>'${positional}',p_name=>'Tudja',p_description=>null,p_category_name=>null,p_duration_minutes=>30,p_price=>1,p_is_active=>true,p_is_public=>true,p_sms_humor_category=>'coloring')`), "", "cross tenant");
  assert(await category(positional) === "null", "cross-tenant update changed nothing");

  // 6. One function of each name; executable by authenticated users, not anon.
  const acl = await postgres.sql(`select string_agg(p.oid::regprocedure::text||':'||r||'='||has_function_privilege(r,p.oid,'execute')::text, ';' order by 1)
    from pg_proc p, unnest(array['anon','authenticated']) r where p.pronamespace='public'::regnamespace and p.proname in ('create_service_v1','update_service_v1')`, "acl");
  assert((acl.match(/:authenticated=true/g) ?? []).length === 2 && !acl.includes("anon=true") && (acl.match(/integer,text\)/g) ?? []).length === 4, `grants ${acl}`);

  console.log("sms confirmation style contract: ok (existing salons standard, values checked, create/update/keep/clear, tenant, grants, other functions unchanged)");
} finally {
  postgres.cleanup();
}

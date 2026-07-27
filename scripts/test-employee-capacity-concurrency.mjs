import { execFileSync, spawn } from "node:child_process";

const container = process.env.BASELINE_DB_CONTAINER ?? "supabase_db_rezervo";
const ownerId = "c1000000-0000-4000-8000-000000000001";
const salonId = "c2000000-0000-4000-8000-000000000001";

function psql(sql) {
  return execFileSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atc", sql], { encoding: "utf8" }).trim();
}

function parallelInsert(name) {
  return new Promise((resolve) => {
    const sql = `insert into public.employees(salon_id,full_name) values ('${salonId}','${name}')`;
    const child = spawn("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(1));
  });
}

try {
  psql(`delete from public.salons where id='${salonId}'; delete from auth.users where id='${ownerId}'; insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('${ownerId}','capacity-concurrency@example.invalid','{}','{}'); insert into public.salons(id,owner_id,name,slug) values ('${salonId}','${ownerId}','Capacity Concurrency','capacity-concurrency'); update public.subscriptions set plan_id=(select id from public.plans where slug='starter'),status='active',trial_starts_at=null,trial_ends_at=null,current_period_ends_at=null where salon_id='${salonId}'; insert into public.employees(salon_id,full_name) values ('${salonId}','Existing One'),('${salonId}','Existing Two');`);
  const codes = await Promise.all([parallelInsert("Concurrent A"), parallelInsert("Concurrent B")]);
  const successful = codes.filter((code) => code === 0).length;
  const activeCount = Number(psql(`select count(*) from public.employees where salon_id='${salonId}' and is_active=true`));
  if (successful !== 1 || activeCount !== 3) throw new Error(`Concurrency contract failed: successful=${successful}, active=${activeCount}`);
  console.log("Employee capacity concurrency passed: one of two inserts acquired the final slot.");
} finally {
  psql(`delete from public.salons where id='${salonId}'; delete from auth.users where id='${ownerId}';`);
}

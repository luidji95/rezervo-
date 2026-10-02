import { execFileSync, spawn } from "node:child_process";

const container = process.env.BASELINE_DB_CONTAINER ?? "supabase_db_rezervo";
const ownerId = "96000000-0000-4000-8000-000000000001";
const salonId = "97000000-0000-4000-8000-000000000001";
const clientId = "98000000-0000-4000-8000-000000000001";
const appointmentId = "99000000-0000-4000-8000-000000000001";

function psql(sql) {
  return execFileSync("docker", ["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atc", sql], { encoding: "utf8" }).trim();
}

function parallelClaim() {
  return new Promise((resolve) => {
    const sql = "select count(*) from public.claim_due_appointment_reminders(1,'2026-08-01T12:00:00Z',10)";
    const child = spawn("docker", ["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atc", sql], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => resolve(code === 0 ? Number(output.trim()) : -1));
    child.on("error", () => resolve(-1));
  });
}

try {
  psql(`
    delete from public.salons where id='${salonId}';
    delete from auth.users where id='${ownerId}';
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values ('${ownerId}','reminder-concurrency@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug)
      values ('${salonId}','${ownerId}','Reminder Concurrency','reminder-concurrency');
    update public.subscriptions
    set plan_id=(select id from public.plans where slug='pro'),
        status='active',
        trial_starts_at=null,
        trial_ends_at=null,
        current_period_starts_at='2026-07-01T00:00:00Z',
        current_period_ends_at='2026-09-01T00:00:00Z'
    where salon_id='${salonId}';
    insert into public.clients(id,salon_id,full_name,phone)
      values ('${clientId}','${salonId}','Reminder Client','+381641234567');
    insert into public.salon_reminder_settings(salon_id,enabled,channel,hours_before)
      values ('${salonId}',true,'sms',24);
    insert into public.appointments(id,salon_id,client_id,start_time,end_time,duration_minutes,price,status,idempotency_key)
      values ('${appointmentId}','${salonId}','${clientId}','2026-08-02T12:00:00Z','2026-08-02T12:30:00Z',30,1000,'pending','95000000-0000-4000-8000-000000000099');
  `);
  const results = await Promise.all([parallelClaim(), parallelClaim()]);
  const claimed = results.reduce((sum, value) => sum + Math.max(value, 0), 0);
  const processing = Number(psql(`select count(*) from public.appointment_reminder_deliveries where salon_id='${salonId}' and status='processing'`));
  const attempts = Number(psql(`select coalesce(sum(attempt_count),0) from public.appointment_reminder_deliveries where salon_id='${salonId}'`));
  if (results.includes(-1) || claimed !== 1 || processing !== 1 || attempts !== 1) {
    throw new Error(`Reminder concurrency contract failed: results=${results.join(",")}, processing=${processing}, attempts=${attempts}`);
  }
  console.log("Reminder entitlement concurrency passed: one active lease and one attempt across two workers.");
} finally {
  psql(`delete from public.salons where id='${salonId}'; delete from auth.users where id='${ownerId}';`);
}

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

// Per-IP limit for new public booking attempts (migration 202611070059) on a disposable PostgreSQL container only.
// 10 per rolling 10 minutes and 40 per rolling 24 hours per key digest; concurrency, boundaries, cleanup and grants.
const TARGET = "202611070059";
const postgres = createDisposableSupabasePostgres("rezervo-public-booking-rate-limit");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const key = () => randomBytes(32).toString("hex");
const hit = (k) => postgres.sql(`select allowed::text||'|'||retry_after_seconds||'|'||coalesce(reason,'-') from public.hit_public_booking_rate_limit_v1('${k}')`, "hit").then((r) => {
  const [allowed, retry, reason] = r.split("|"); return { allowed: allowed === "true", retry: Number(retry), reason };
});
const events = (k) => postgres.sql(`select count(*) from public.public_booking_rate_limit_events where key_hash=decode('${k}','hex')`, "events").then(Number);
const seed = (k, ages) => postgres.sql(`insert into public.public_booking_rate_limit_events(key_hash, created_at)
  select decode('${k}','hex'), clock_timestamp() - a from unnest(array[${ages.map((a) => `interval '${a}'`).join(",")}]) a`, "seed");

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
  const md5 = () => postgres.sql(`select md5(string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc), ',' order by p.oid::regprocedure::text)) from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname <> 'hit_public_booking_rate_limit_v1'`, "md5");
  const before = await md5();
  await postgres.applySqlFile(`supabase/migrations/${target}`, TARGET);

  // 0. Additive; private.
  assert(await md5() === before, "no existing function changes");
  const acl = await postgres.sql(`select string_agg(r||'='||has_function_privilege(r,'public.hit_public_booking_rate_limit_v1(text)','execute')::text, ',' order by r)
    ||';'||string_agg(r||'='||has_table_privilege(r,'public.public_booking_rate_limit_events','select,insert,update,delete')::text, ',' order by r) from unnest(array['anon','authenticated','service_role']) r`, "acl");
  assert(acl === "anon=false,authenticated=false,service_role=true;anon=false,authenticated=false,service_role=false", `grants ${acl}`);
  let invalid = "fulfilled";
  try { await hit("not-a-key"); } catch (error) { invalid = error.message; }
  assert(invalid.includes("valid rate limit key"), "invalid key rejected");

  // 1. 10 per 10 minutes: the 11th is refused with a retry time and is not recorded.
  const a = key();
  for (let i = 1; i <= 10; i += 1) assert((await hit(a)).allowed, `attempt ${i} allowed`);
  const eleventh = await hit(a);
  assert(!eleventh.allowed && eleventh.reason === "per_10_minutes" && eleventh.retry > 590 && eleventh.retry <= 600 && await events(a) === 10, `11th refused ${JSON.stringify(eleventh)}`);
  // Boundary: an attempt exactly 10 minutes old no longer counts.
  await postgres.sql(`update public.public_booking_rate_limit_events set created_at = clock_timestamp() - interval '10 minutes 1 second' where id = (select min(id) from public.public_booking_rate_limit_events where key_hash=decode('${a}','hex'))`, "age one");
  assert((await hit(a)).allowed, "after the oldest leaves the 10-minute window one more attempt passes");
  assert(!(await hit(a)).allowed, "and the window is full again");
  const other = key();
  assert((await hit(other)).allowed, "another key is independent");

  // 2. 40 per 24 hours, across 10-minute windows; the retry time follows the oldest counted attempt.
  const b = key();
  await seed(b, [...Array(39)].map((_, i) => `${11 + i * 30} minutes`));
  const fortieth = await hit(b);
  assert(fortieth.allowed, "40th attempt in 24 h allowed");
  const fortyFirst = await hit(b);
  const oldestAge = 11 + 38 * 30; // minutes
  assert(!fortyFirst.allowed && fortyFirst.reason === "per_day" && Math.abs(fortyFirst.retry - (24 * 60 - oldestAge) * 60) <= 5, `41st refused per_day ${JSON.stringify(fortyFirst)}`);
  await postgres.sql(`update public.public_booking_rate_limit_events set created_at = clock_timestamp() - interval '24 hours 1 second' where id = (select min(id) from public.public_booking_rate_limit_events where key_hash=decode('${b}','hex'))`, "age day");
  assert((await hit(b)).allowed, "when the oldest leaves 24 hours a place frees up (and the expired row is removed)");
  assert(await events(b) === 40, `own rows older than 24 h are removed (${await events(b)})`);

  // 3. Concurrency: 30 parallel attempts for one key -> exactly 10 recorded and allowed.
  const c = key();
  const results = await Promise.all(Array.from({ length: 30 }, () => hit(c)));
  assert(results.filter((r) => r.allowed).length === 10 && results.filter((r) => !r.allowed && r.reason === "per_10_minutes").length === 20 && await events(c) === 10, `parallel: ${results.filter((r) => r.allowed).length} allowed`);
  // 30 parallel for 3 keys -> 10 each.
  const keys = [key(), key(), key()];
  const mixed = await Promise.all(Array.from({ length: 45 }, (_, i) => hit(keys[i % 3]).then((r) => [i % 3, r.allowed])));
  for (const k of [0, 1, 2]) assert(mixed.filter(([index, allowed]) => index === k && allowed).length === 10, `key ${k}: 10 allowed`);

  // 4. Lazy cleanup: rows older than 2 days of other keys are removed (at most 200 per call), only when someone hits.
  const stale = key();
  await seed(stale, Array.from({ length: 250 }, () => "3 days"));
  assert(await events(stale) === 250, "stale rows stay until another attempt");
  await hit(key());
  assert(await events(stale) === 50, `one call removes at most 200 stale rows (${await events(stale)} left)`);
  await hit(key());
  assert(await events(stale) === 0, "the next call removes the rest");

  console.log("Public booking rate limit test passed (additive, private grants, invalid key, 10/10 min with exact boundary and retry time, refused attempts not recorded, independent keys, 40/24 h with retry time and expiry, 30 parallel -> 10, 3 keys x 15 parallel -> 10 each, lazy cleanup of stale rows only on new attempts).");
} finally {
  postgres.cleanup();
}

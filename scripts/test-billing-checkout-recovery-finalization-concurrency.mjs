import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const image = "public.ecr.aws/supabase/postgres:17.6.1.121";
const container = `rezervo-checkout-finalization-${process.pid}-${Date.now()}`;
const database = "postgres";
const cutover = readFileSync("supabase/baseline/cutover.txt", "utf8").trim();

function fail(label, message) {
  throw new Error(`[${label}] ${message}`);
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`Docker command failed (${result.status}): ${(result.stderr ?? "").trim()}`);
  }
  return (result.stdout ?? "").trim();
}

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-XAt", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
}

function sql(sqlText, label) {
  const result = spawnSync("docker", psqlArgs(), { input: sqlText, encoding: "utf8" });
  if (result.status !== 0) fail(label, (result.stderr ?? "SQL command failed").trim());
  return (result.stdout ?? "").trim();
}

function applySqlFile(path, label) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`[${label}] ${stderr.trim()}`)));
    createReadStream(path).on("error", reject).pipe(child.stdin);
  });
}

function startSession(sqlText, label) {
  const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const listeners = new Map();
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    for (const [marker, resolve] of listeners) {
      if (stdout.includes(marker)) {
        listeners.delete(marker);
        resolve();
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`[${label}] session failed (${code}): ${stderr.trim()}`)));
  });
  child.stdin.end(sqlText);
  return {
    done,
    waitFor(marker) {
      if (stdout.includes(marker)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        listeners.set(marker, resolve);
        done.catch(reject);
      });
    },
  };
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function finalizerSql(fixture, providerId, hash, expiry) {
  return `
    set lock_timeout='10s'; set statement_timeout='30s';
    select finalization_outcome||'|'||coalesce(ledger_status,'')||'|'||coalesce(attempt_status,'')||'|'||coalesce(audit_outcome,'')
    from public.finalize_billing_checkout_recovery_v1(
      ${quote(fixture.attemptId)}::uuid,${quote(fixture.token)}::uuid,'test',
      ${quote(providerId)},${quote(hash)},${quote(expiry)}::timestamptz);
  `;
}

function outcome(output) {
  const allowed = /^(finalized|already_finalized|finalization_conflict|attempt_state_conflict|provider_id_conflict|provider_checkout_expired|ledger_state_conflict|claim_lost)\|/;
  const line = output.split(/\r?\n/).map((item) => item.trim()).find((item) => allowed.test(item));
  if (!line) throw new Error(`Finalizer result missing from session output: ${output}`);
  return line.split("|")[0];
}

function jsonQuery(query, label) {
  const output = sql(query, label);
  const line = output.split(/\r?\n/).find((item) => item.trim().startsWith("{"));
  if (!line) fail(label, `JSON state missing: ${output}`);
  return JSON.parse(line);
}

function fixtureSql(fixtures, leaseSeconds = 600) {
  const owners = fixtures.map((fixture) => `(
    ${quote(fixture.ownerId)}::uuid,${quote(`${fixture.ownerId}@example.invalid`)},'{}','{}'
  )`).join(",");
  const salons = fixtures.map((fixture) => `(
    ${quote(fixture.salonId)}::uuid,${quote(fixture.ownerId)}::uuid,
    'Finalization concurrency',${quote(`finalize-${fixture.salonId}`)}
  )`).join(",");
  const values = fixtures.map((fixture) => `(
    ${quote(fixture.checkoutId)}::uuid,${quote(fixture.salonId)}::uuid,${quote(fixture.ownerId)}::uuid,
    (select id from public.plans where slug='pro'),
    'lemonsqueezy','test',${quote(randomUUID())}::uuid,'creating',clock_timestamp(),clock_timestamp()
  )`).join(",");
  const attempts = fixtures.map((fixture) => `(
    ${quote(fixture.attemptId)}::uuid,${quote(fixture.checkoutId)}::uuid,'lemonsqueezy','test','claimed',null,
    ${quote(fixture.token)}::uuid,clock_timestamp()-interval '1 minute',
    clock_timestamp()+interval '${leaseSeconds} seconds',null,1,
    clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute'
  )`).join(",");
  return `
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values ${owners};
    insert into public.salons(id,owner_id,name,slug)
      values ${salons};
    insert into public.billing_checkout_sessions(
      id,salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status,created_at,updated_at
    ) values ${values};
    insert into public.billing_checkout_recovery_attempts(
      id,checkout_session_id,provider,environment,status,outcome,claim_token,
      claimed_at,lease_expires_at,completed_at,attempt_number,created_at,updated_at
    ) values ${attempts};
  `;
}

function newFixture() {
  return {
    ownerId: randomUUID(),
    salonId: randomUUID(),
    checkoutId: randomUUID(),
    attemptId: randomUUID(),
    token: randomUUID(),
  };
}

async function concurrentPair(label, leftSql, rightSql, barrierKey) {
  const holder = startSession(`
    begin; set local statement_timeout='30s';
    select pg_catalog.pg_advisory_xact_lock(${barrierKey});
    \\echo BARRIER_READY
    select pg_catalog.pg_sleep(1); commit;
  `, `${label}:barrier`);
  await holder.waitFor("BARRIER_READY");
  const wrap = (body) => `
    set lock_timeout='10s'; set statement_timeout='30s';
    select pg_catalog.pg_advisory_lock_shared(${barrierKey});
    ${body}
  `;
  const left = startSession(wrap(leftSql), `${label}:left`);
  const right = startSession(wrap(rightSql), `${label}:right`);
  const [leftOutput, rightOutput] = await Promise.all([left.done, right.done, holder.done]).then(([a, b]) => [a, b]);
  return [leftOutput, rightOutput];
}

function finalizerCallOnly(fixture, providerId, hash, expiry) {
  return `select finalization_outcome||'|'||coalesce(ledger_status,'')||'|'||coalesce(attempt_status,'')||'|'||coalesce(audit_outcome,'')
    from public.finalize_billing_checkout_recovery_v1(
      ${quote(fixture.attemptId)}::uuid,${quote(fixture.token)}::uuid,'test',${quote(providerId)},${quote(hash)},${quote(expiry)}::timestamptz);`;
}

async function initializeDatabase() {
  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", image]);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", database], { encoding: "utf8" });
    if (ready.status === 0) break;
    if (attempt === 89) throw new Error("Disposable PostgreSQL did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  // The Supabase image continues installing extension objects briefly after
  // pg_isready succeeds. Avoid racing its graphql initialization.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await applySqlFile("supabase/baseline/schema.sql", "baseline schema");
  await applySqlFile("supabase/baseline/reference_seed.sql", "reference seed");
  const migrations = readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql") && basename(name, ".sql") > cutover)
    .sort();
  for (const migration of migrations) await applySqlFile(join("supabase/migrations", migration), migration);
}

async function scenarioIdentical() {
  const label = "identical finalizers";
  const fixture = newFixture();
  const hash = "1".repeat(64);
  const expiry = new Date(Date.now() + 3_600_000).toISOString();
  sql(fixtureSql([fixture]), label);
  const providerId = "81010000-0000-0000-0000-000000000001";
  const call = finalizerCallOnly(fixture, providerId, hash, expiry);
  const outputs = await concurrentPair(label, call, call, 33001);
  const outcomes = outputs.map(outcome).sort();
  if (outcomes.join(",") !== "already_finalized,finalized") fail(label, `unexpected outcomes: ${outcomes}`);
  const state = jsonQuery(`select pg_catalog.json_build_object(
    'ledgerStatus',c.status,'providerId',c.provider_session_id,'hash',c.checkout_url_hash,
    'expiryMatches',c.expires_at=${quote(expiry)}::timestamptz,'attemptStatus',a.status,'audit',a.outcome,
    'attemptCount',(select count(*) from public.billing_checkout_recovery_attempts x where x.checkout_session_id=c.id)
  )::text from public.billing_checkout_sessions c join public.billing_checkout_recovery_attempts a on a.checkout_session_id=c.id
  where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  if (state.ledgerStatus !== "open" || state.providerId !== providerId || state.hash !== hash || !state.expiryMatches
    || state.attemptStatus !== "completed" || state.audit !== "recovered_open" || state.attemptCount !== 1) fail(label, JSON.stringify(state));
  console.log("SCENARIO 1 PASS: identical finalizers -> finalized + already_finalized");
}

async function scenarioDifferentIds() {
  const label = "different provider IDs";
  const fixture = newFixture();
  const hash = "2".repeat(64);
  const expiry = new Date(Date.now() + 3_600_000).toISOString();
  sql(fixtureSql([fixture]), label);
  const outputs = await concurrentPair(label,
    finalizerCallOnly(fixture, "82010000-0000-0000-0000-000000000001", hash, expiry),
    finalizerCallOnly(fixture, "82020000-0000-0000-0000-000000000002", hash, expiry), 33002);
  const outcomes = outputs.map(outcome).sort();
  if (outcomes.join(",") !== "finalization_conflict,finalized") fail(label, `unexpected outcomes: ${outcomes}`);
  const state = jsonQuery(`select pg_catalog.json_build_object('providerId',c.provider_session_id,'status',c.status,
    'attemptStatus',a.status,'audit',a.outcome) from public.billing_checkout_sessions c
    join public.billing_checkout_recovery_attempts a on a.checkout_session_id=c.id where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  if (!["82010000-0000-0000-0000-000000000001", "82020000-0000-0000-0000-000000000002"].includes(state.providerId) || state.status !== "open" || state.attemptStatus !== "completed" || state.audit !== "recovered_open") fail(label, JSON.stringify(state));
  console.log("SCENARIO 2 PASS: different IDs -> finalized + finalization_conflict");
}

async function scenarioProviderCollision() {
  const label = "provider ID collision";
  const leftFixture = newFixture();
  const rightFixture = newFixture();
  const expiry = new Date(Date.now() + 3_600_000).toISOString();
  sql(fixtureSql([leftFixture, rightFixture]), label);
  const providerId = "83010000-0000-0000-0000-000000000001";
  const outputs = await concurrentPair(label,
    finalizerCallOnly(leftFixture, providerId, "3".repeat(64), expiry),
    finalizerCallOnly(rightFixture, providerId, "4".repeat(64), expiry), 33003);
  const outcomes = outputs.map(outcome).sort();
  if (outcomes.join(",") !== "finalized,provider_id_conflict") fail(label, `unexpected outcomes: ${outcomes}`);
  const state = jsonQuery(`select pg_catalog.json_build_object(
    'idCount',count(*) filter(where c.provider_session_id=${quote(providerId)}),
    'openRecovered',count(*) filter(where c.status='open' and a.status='completed' and a.outcome='recovered_open'),
    'creatingManual',count(*) filter(where c.status='creating' and c.provider_session_id is null and a.status='completed' and a.outcome='manual_review')
  ) from public.billing_checkout_sessions c join public.billing_checkout_recovery_attempts a on a.checkout_session_id=c.id
  where c.id in (${quote(leftFixture.checkoutId)}::uuid,${quote(rightFixture.checkoutId)}::uuid)`, label);
  if (state.idCount !== 1 || state.openRecovered !== 1 || state.creatingManual !== 1) fail(label, JSON.stringify(state));
  console.log("SCENARIO 3 PASS: shared provider ID -> finalized + provider_id_conflict");
}

async function scenarioLockPastLease() {
  const label = "ledger lock past lease";
  const fixture = newFixture();
  sql(fixtureSql([fixture], 2), label);
  if (sql(`select lease_expires_at>clock_timestamp() from public.billing_checkout_recovery_attempts where id=${quote(fixture.attemptId)}::uuid`, label) !== "t") fail(label, "fixture lease was not active before contention");
  const holder = startSession(`begin; set local statement_timeout='30s';
    select 1 from public.billing_checkout_sessions where id=${quote(fixture.checkoutId)}::uuid for update;
    \\echo LEDGER_LOCKED
    select pg_catalog.pg_sleep(3); commit;`, `${label}:holder`);
  await holder.waitFor("LEDGER_LOCKED");
  const finalizer = startSession(finalizerSql(fixture, "84010000-0000-0000-0000-000000000001", "5".repeat(64), new Date(Date.now() + 60_000).toISOString()), `${label}:finalizer`);
  const [output] = await Promise.all([finalizer.done, holder.done]);
  if (outcome(output) !== "claim_lost") fail(label, output);
  const state = jsonQuery(`select pg_catalog.json_build_object('ledger',c.status,'providerId',c.provider_session_id,'attempt',a.status,'audit',a.outcome)
    from public.billing_checkout_sessions c join public.billing_checkout_recovery_attempts a on a.checkout_session_id=c.id where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  if (state.ledger !== "creating" || state.providerId !== null || state.attempt !== "abandoned" || state.audit !== "claim_lost") fail(label, JSON.stringify(state));
  console.log("SCENARIO 4 PASS: lock wait crossed lease -> claim_lost");
}

async function scenarioLockPastProviderExpiry() {
  const label = "ledger lock past provider expiry";
  const fixture = newFixture();
  sql(fixtureSql([fixture], 60), label);
  const expiry = new Date(Date.now() + 2_000).toISOString();
  const holder = startSession(`begin; set local statement_timeout='30s';
    select 1 from public.billing_checkout_sessions where id=${quote(fixture.checkoutId)}::uuid for update;
    \\echo LEDGER_LOCKED
    select pg_catalog.pg_sleep(3); commit;`, `${label}:holder`);
  await holder.waitFor("LEDGER_LOCKED");
  const finalizer = startSession(finalizerSql(fixture, "85010000-0000-0000-0000-000000000001", "6".repeat(64), expiry), `${label}:finalizer`);
  const [output] = await Promise.all([finalizer.done, holder.done]);
  if (outcome(output) !== "provider_checkout_expired") fail(label, output);
  const state = jsonQuery(`select pg_catalog.json_build_object('ledger',c.status,'providerId',c.provider_session_id,'attempt',a.status,'audit',a.outcome)
    from public.billing_checkout_sessions c join public.billing_checkout_recovery_attempts a on a.checkout_session_id=c.id where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  if (state.ledger !== "creating" || state.providerId !== null || state.attempt !== "completed" || state.audit !== "invalid_candidate") fail(label, JSON.stringify(state));
  console.log("SCENARIO 5 PASS: lock wait crossed provider expiry -> provider_checkout_expired");
}

async function scenarioGenericCompletionRace() {
  const label = "generic completion race";
  const fixture = newFixture();
  sql(fixtureSql([fixture], 60), label);
  const holder = startSession(`begin; set local statement_timeout='30s';
    select 1 from public.billing_checkout_sessions where id=${quote(fixture.checkoutId)}::uuid for update;
    \\echo LEDGER_LOCKED
    select pg_catalog.pg_sleep(1);
    select completion_outcome||'|'||status||'|'||coalesce(outcome,'') from public.complete_billing_checkout_recovery_attempt_v1(
      ${quote(fixture.attemptId)}::uuid,${quote(fixture.token)}::uuid,'test','still_pending',clock_timestamp());
    commit;`, `${label}:generic`);
  await holder.waitFor("LEDGER_LOCKED");
  const finalizer = startSession(finalizerSql(fixture, "86010000-0000-0000-0000-000000000001", "7".repeat(64), new Date(Date.now() + 60_000).toISOString()), `${label}:finalizer`);
  const [finalizerOutput, genericOutput] = await Promise.all([finalizer.done, holder.done]);
  if (!genericOutput.includes("completed|completed|still_pending") || outcome(finalizerOutput) !== "attempt_state_conflict") fail(label, `${genericOutput}\n${finalizerOutput}`);
  const state = jsonQuery(`select pg_catalog.json_build_object('ledger',c.status,'providerId',c.provider_session_id,'attempt',a.status,'audit',a.outcome)
    from public.billing_checkout_sessions c join public.billing_checkout_recovery_attempts a on a.checkout_session_id=c.id where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  if (state.ledger !== "creating" || state.providerId !== null || state.attempt !== "completed" || state.audit !== "still_pending") fail(label, JSON.stringify(state));
  console.log("SCENARIO 6 PASS: generic completion wins -> attempt_state_conflict");
}

async function scenarioLifecycleRace() {
  const label = "lifecycle ledger mutation race";
  const fixture = newFixture();
  sql(fixtureSql([fixture], 60), label);
  const subscriptionBefore = sql(`select pg_catalog.md5(pg_catalog.row_to_json(s)::text) from public.subscriptions s
    join public.billing_checkout_sessions c on c.salon_id=s.salon_id where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  if (!subscriptionBefore) fail(label, "subscription fixture missing");
  const holder = startSession(`begin; set local statement_timeout='30s';
    select 1 from public.billing_checkout_sessions where id=${quote(fixture.checkoutId)}::uuid for update;
    \\echo LEDGER_LOCKED
    select pg_catalog.pg_sleep(1);
    update public.billing_checkout_sessions set status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=${quote(fixture.checkoutId)}::uuid;
    commit;`, `${label}:lifecycle`);
  await holder.waitFor("LEDGER_LOCKED");
  const finalizer = startSession(finalizerSql(fixture, "87010000-0000-0000-0000-000000000001", "8".repeat(64), new Date(Date.now() + 60_000).toISOString()), `${label}:finalizer`);
  const [output] = await Promise.all([finalizer.done, holder.done]);
  if (outcome(output) !== "ledger_state_conflict") fail(label, output);
  const state = jsonQuery(`select pg_catalog.json_build_object('ledger',c.status,'providerId',c.provider_session_id,'attempt',a.status,'audit',a.outcome)
    from public.billing_checkout_sessions c join public.billing_checkout_recovery_attempts a on a.checkout_session_id=c.id where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  const subscriptionAfter = sql(`select pg_catalog.md5(pg_catalog.row_to_json(s)::text) from public.subscriptions s
    join public.billing_checkout_sessions c on c.salon_id=s.salon_id where c.id=${quote(fixture.checkoutId)}::uuid`, label);
  if (state.ledger !== "completed" || state.providerId !== null || state.attempt !== "completed" || state.audit !== "manual_review" || subscriptionAfter !== subscriptionBefore) fail(label, JSON.stringify(state));
  console.log("SCENARIO 7 PASS: lifecycle mutation wins -> ledger_state_conflict");
}

let initialized = false;
try {
  await initializeDatabase();
  initialized = true;
  await scenarioIdentical();
  await scenarioDifferentIds();
  await scenarioProviderCollision();
  await scenarioLockPastLease();
  await scenarioLockPastProviderExpiry();
  await scenarioGenericCompletionRace();
  await scenarioLifecycleRace();
  console.log("Billing checkout recovery finalization concurrency contract passed.");
} finally {
  if (initialized || spawnSync("docker", ["inspect", container], { stdio: "ignore" }).status === 0) {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  }
}

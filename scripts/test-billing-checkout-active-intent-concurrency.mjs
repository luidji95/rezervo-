import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const image = "public.ecr.aws/supabase/postgres:17.6.1.121";
const container = `rezervo-checkout-intent-concurrency-${process.pid}-${Date.now()}`;
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

function sqlSession(sqlText, label) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`[${label}] session failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(sqlText);
  });
}

function applySqlFile(path, label) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`[${label}] ${stderr.trim()}`)));
    createReadStream(path).on("error", reject).pipe(child.stdin);
  });
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function initializeDatabase() {
  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", image]);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", database], { stdio: "ignore" });
    if (ready.status === 0) break;
    if (attempt === 89) throw new Error("Disposable PostgreSQL did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await applySqlFile("supabase/baseline/schema.sql", "baseline schema");
  await applySqlFile("supabase/baseline/reference_seed.sql", "reference seed");
  const migrations = readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql") && basename(name, ".sql") > cutover)
    .sort();
  for (const migration of migrations) {
    await applySqlFile(join("supabase/migrations", migration), migration);
  }
}

function createFixture(label) {
  const ownerId = randomUUID();
  const salonId = randomUUID();
  sql(`
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values(${quote(ownerId)}::uuid,${quote(`${ownerId}@example.invalid`)},'{}','{}');
    insert into public.salons(id,owner_id,name,slug)
    values(${quote(salonId)}::uuid,${quote(ownerId)}::uuid,'Intent concurrency',${quote(`intent-${salonId.slice(0, 8)}`)});
  `, label);
  return { ownerId, salonId };
}

function acquireSql(fixture, planSlug) {
  return `
    set lock_timeout='10s';
    set statement_timeout='30s';
    select acquisition_outcome||'|'||checkout_session_id||'|'||idempotency_key||'|'||requested_plan_id
    from public.acquire_billing_checkout_intent_v1(
      ${quote(fixture.salonId)}::uuid,
      ${quote(fixture.ownerId)}::uuid,
      (select id from public.plans where slug=${quote(planSlug)}),
      'lemonsqueezy',
      'test'
    );
  `;
}

function parseResult(output, label) {
  const line = output.split(/\r?\n/).map((value) => value.trim()).find((value) => /^(created|existing)\|/.test(value));
  if (!line) fail(label, `acquire result missing: ${output}`);
  const [outcome, checkoutSessionId, idempotencyKey, requestedPlanId] = line.split("|");
  return { outcome, checkoutSessionId, idempotencyKey, requestedPlanId };
}

async function runScenario(label, planSlugs) {
  const fixture = createFixture(label);
  const outputs = await Promise.all(planSlugs.map((planSlug, index) =>
    sqlSession(acquireSql(fixture, planSlug), `${label}:caller-${index + 1}`),
  ));
  const results = outputs.map((output) => parseResult(output, label));
  const created = results.filter((result) => result.outcome === "created");
  const existing = results.filter((result) => result.outcome === "existing");
  const checkoutIds = new Set(results.map((result) => result.checkoutSessionId));
  const idempotencyKeys = new Set(results.map((result) => result.idempotencyKey));
  if (created.length !== 1 || existing.length !== results.length - 1) {
    fail(label, `expected one created and ${results.length - 1} existing, got ${JSON.stringify(results)}`);
  }
  if (checkoutIds.size !== 1 || idempotencyKeys.size !== 1) {
    fail(label, `callers did not receive one database identity: ${JSON.stringify(results)}`);
  }
  const state = sql(`
    select count(*)||'|'||count(distinct id)||'|'||count(distinct idempotency_key)
    from public.billing_checkout_sessions
    where salon_id=${quote(fixture.salonId)}::uuid
      and provider='lemonsqueezy' and environment='test'
      and status in ('creating','open');
  `, label);
  if (state !== "1|1|1") fail(label, `active ledger state invalid: ${state}`);
  return results;
}

async function runExpiredOpenScenario() {
  const label = "expired-open parallel replacement";
  const fixture = createFixture(label);
  const original = parseResult(sql(acquireSql(fixture, "starter"), `${label}:seed`), label);
  const providerCheckoutId = randomUUID();
  sql(`
    update public.billing_checkout_sessions
    set status='open',
        provider_session_id=${quote(providerCheckoutId)},
        checkout_url_hash=repeat('a',64),
        expires_at=pg_catalog.clock_timestamp()-interval '1 second'
    where id=${quote(original.checkoutSessionId)}::uuid and status='creating';
  `, `${label}:expire-seed`);

  const outputs = await Promise.all(["starter", "starter", "starter", "starter"].map((planSlug, index) =>
    sqlSession(acquireSql(fixture, planSlug), `${label}:caller-${index + 1}`),
  ));
  const results = outputs.map((output) => parseResult(output, label));
  const created = results.filter((result) => result.outcome === "created");
  const existing = results.filter((result) => result.outcome === "existing");
  const checkoutIds = new Set(results.map((result) => result.checkoutSessionId));
  const idempotencyKeys = new Set(results.map((result) => result.idempotencyKey));
  if (created.length !== 1 || existing.length !== 3 || checkoutIds.size !== 1 || idempotencyKeys.size !== 1) {
    fail(label, `replacement acquisition invalid: ${JSON.stringify(results)}`);
  }
  if (checkoutIds.has(original.checkoutSessionId)) fail(label, "expired checkout was returned as active");
  const state = sql(`
    select
      count(*) filter (where id=${quote(original.checkoutSessionId)}::uuid and status='expired')||'|'||
      count(*) filter (where status in ('creating','open'))||'|'||
      count(distinct id) filter (where status in ('creating','open'))||'|'||
      count(distinct idempotency_key) filter (where status in ('creating','open'))
    from public.billing_checkout_sessions
    where salon_id=${quote(fixture.salonId)}::uuid
      and provider='lemonsqueezy' and environment='test';
  `, label);
  if (state !== "1|1|1|1") fail(label, `replacement ledger state invalid: ${state}`);
}

let initialized = false;
try {
  await initializeDatabase();
  initialized = true;
  await runScenario("same-plan parallel acquire", ["starter", "starter", "starter", "starter"]);
  console.log("SCENARIO 1 PASS: same-plan callers -> one created, remaining existing, one active ledger");
  const mixed = await runScenario("different-plan parallel acquire", ["starter", "pro", "starter", "pro"]);
  if (new Set(mixed.map((result) => result.checkoutSessionId)).size !== 1) {
    fail("different-plan parallel acquire", "different plans did not collide at database scope");
  }
  console.log("SCENARIO 2 PASS: different-plan callers -> one created, remaining existing, one active ledger");
  await runExpiredOpenScenario();
  console.log("SCENARIO 3 PASS: expired open -> one created replacement, remaining existing, one active ledger");
  console.log("Billing checkout active intent concurrency contract passed on disposable PostgreSQL.");
} finally {
  if (initialized || spawnSync("docker", ["inspect", container], { stdio: "ignore" }).status === 0) {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  }
}

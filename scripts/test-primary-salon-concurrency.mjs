import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_rezervo", "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`psql failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(sql);
  });
}

for (let iteration = 1; iteration <= 3; iteration += 1) {
  const ownerId = randomUUID();
  const slug = `bootstrap-concurrency-${randomUUID().slice(0, 8)}`;
  await psql(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${ownerId}','${ownerId}@example.invalid','{}','{}');`);
  const call = (candidate) => psql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${ownerId}',true); select salon_id::text||'|'||was_created::text from public.create_primary_salon_once_v1('Concurrency Salon','${candidate}','barbershop',null,null,null,null,null,null); commit;`);
  const [first, second] = await Promise.all([call(slug), call(`${slug}-alternate`)]);
  const parse = (value) => value.split(/\r?\n/).find((line) => /^[0-9a-f-]{36}\|(true|false)$/.test(line));
  const results = [parse(first), parse(second)];
  if (results.some((value) => !value)) throw new Error(`Iteration ${iteration}: missing RPC result`);
  const [firstId, firstCreated] = results[0].split("|");
  const [secondId, secondCreated] = results[1].split("|");
  if (firstId !== secondId || [firstCreated, secondCreated].sort().join("|") !== "false|true") throw new Error(`Iteration ${iteration}: responses were not idempotent`);
  const counts = await psql(`select (select count(*) from public.salons where owner_id='${ownerId}')||'|'||(select count(*) from public.salon_members where profile_id='${ownerId}' and role='owner')||'|'||(select count(*) from public.subscriptions where salon_id='${firstId}');`);
  if (counts !== "1|1|1") throw new Error(`Iteration ${iteration}: unexpected counts ${counts}`);
  await psql(`delete from auth.users where id='${ownerId}';`);
}

console.log("Primary salon concurrency test passed (3 iterations).");

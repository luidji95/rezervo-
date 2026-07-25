import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202607220020_reminder_cron_foundation.sql",
  "utf8",
);
const operations = readFileSync("supabase/snippets/reminder_cron_operations.sql", "utf8");

test("foundation migration enables infrastructure without scheduling a job", () => {
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /create extension if not exists supabase_vault/i);
  assert.doesNotMatch(migration, /cron\.schedule\s*\(/i);
});

test("Vault names and function privileges are explicit", () => {
  assert.match(migration, /rezervo_reminder_worker_url/);
  assert.match(migration, /rezervo_reminder_cron_secret/);
  assert.match(migration, /revoke all on function private\.invoke_rezervo_reminder_worker\(\) from public/i);
  assert.match(migration, /from anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function private\.invoke_rezervo_reminder_worker\(\) to postgres/i);
});

test("manual operations document schedule, emergency stop and observability", () => {
  assert.match(operations, /cron\.schedule\s*\(/i);
  assert.match(operations, /\*\/5 \* \* \* \*/);
  assert.match(operations, /cron\.unschedule\s*\(/i);
  assert.match(operations, /cron\.job_run_details/i);
  assert.match(operations, /net\._http_response/i);
});

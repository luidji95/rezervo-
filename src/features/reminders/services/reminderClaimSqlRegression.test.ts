import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202607220021_fix_ambiguous_reminder_claim_columns.sql",
  "utf8",
);

test("keeps the existing claim RPC signature and return contract", () => {
  assert.match(
    migration,
    /claim_due_appointment_reminders\([\s\S]*p_batch_size integer default 50,[\s\S]*p_now timestamptz default now\(\),[\s\S]*p_lease_minutes integer default 10/,
  );
  for (const output of [
    "delivery_id uuid",
    "salon_id uuid",
    "appointment_id uuid",
    "client_id uuid",
    "attempt_count integer",
    "lease_expires_at timestamptz",
    "claim_token uuid",
  ]) {
    assert.match(migration, new RegExp(output));
  }
});

test("qualifies the formerly ambiguous max-attempt fields", () => {
  assert.match(migration, /pg_catalog\.pg_get_functiondef/);
  assert.match(migration, /UNEXPECTED_REMINDER_CLAIM_DEFINITION/);
  assert.match(migration, /REMINDER_CLAIM_REPLACEMENT_VERIFICATION_FAILED/);
  assert.match(migration, /delivery\.attempt_count >= delivery\.max_attempts/);
  assert.match(migration, /delivery\.lease_expires_at < p_now/);
  assert.match(migration, /coalesce\(delivery\.next_retry_at, delivery\.scheduled_for\)/);
  assert.doesNotMatch(migration, /where attempt_count >= max_attempts/);
});

test("uses the named idempotency constraint and preserves safe claiming", () => {
  assert.match(migration, /on conflict on constraint reminder_delivery_schedule_unique do nothing/);
  assert.match(migration, /limit p_batch_size\s+for update of delivery skip locked/);
  assert.match(migration, /claim_token = gen_random_uuid\(\)/);
  assert.match(migration, /where delivery\.id = v_candidate\.id/);
});

test("preserves eligibility, quota, and empty-result semantics", () => {
  assert.match(migration, /appointment\.status in \('pending', 'confirmed'\)/);
  assert.match(migration, /reminder_settings\.enabled/);
  assert.match(migration, /plan\.sms_reminders_enabled/);
  assert.match(migration, /v_accepted_count \+ v_reserved_count >= v_monthly_limit/);
  assert.doesNotMatch(migration, /raise exception 'NO_CANDIDATES'/);
});

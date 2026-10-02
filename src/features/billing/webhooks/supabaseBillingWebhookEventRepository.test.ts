import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositorySource = readFileSync(
  join(here, "supabaseBillingWebhookEventRepository.ts"),
  "utf8",
);
const retryRepositorySource = readFileSync(
  join(here, "../retryWorker/supabaseBillingWebhookRetryRepository.ts"),
  "utf8",
);
const createdV1Migration = readFileSync(
  join(here, "../../../../supabase/migrations/202607280022_verified_subscription_created_processing.sql"),
  "utf8",
);
const updatedV1Migration = readFileSync(
  join(here, "../../../../supabase/migrations/202607280023_verified_subscription_updated_lifecycle.sql"),
  "utf8",
);
const generatedTypesSource = readFileSync(
  join(here, "../../../types/database.generated.ts"),
  "utf8",
);

test("webhook repository calls only environment-aware v2 subscription processors", () => {
  assert.match(repositorySource, /\.rpc\("process_billing_subscription_created_v2",[\s\S]*?\{\s*p_webhook_event_id:\s*eventId,?\s*\}/);
  assert.match(repositorySource, /\.rpc\("process_billing_subscription_updated_v2",[\s\S]*?\{\s*p_webhook_event_id:\s*eventId,?\s*\}/);
  assert.doesNotMatch(repositorySource, /process_billing_subscription_(?:created|updated)_v1/);
  assert.doesNotMatch(
    repositorySource,
    /process_billing_subscription_(?:created|updated)_v2[\s\S]{0,160}p_environment/,
  );
  for (const outcome of [
    "processed",
    "already_processed",
    "already_applied",
    "stale_ignored",
    "dependency_pending",
    "manual_review",
  ]) {
    assert.match(repositorySource, new RegExp(`"${outcome}"`));
  }
});

test("retry repository delegates to the same v2-backed processing methods without fallback", () => {
  assert.match(
    retryRepositorySource,
    /return this\.processorRepository\.processSubscriptionCreated\(eventId\)/,
  );
  assert.match(
    retryRepositorySource,
    /return this\.processorRepository\.processSubscriptionUpdated\(eventId\)/,
  );
  assert.doesNotMatch(retryRepositorySource, /process_billing_subscription_(?:created|updated)_v1/);
});

test("v1 SQL processors remain present only as database compatibility surfaces", () => {
  assert.match(createdV1Migration, /create or replace function public\.process_billing_subscription_created_v1\(/);
  assert.match(updatedV1Migration, /create or replace function public\.process_billing_subscription_updated_v1\(/);
});

test("generated database types expose both v2 RPCs without an environment argument", () => {
  for (const processor of ["created", "updated"]) {
    assert.match(
      generatedTypesSource,
      new RegExp(
        `process_billing_subscription_${processor}_v2: \\{\\s*Args: \\{ p_now\\?: string; p_webhook_event_id: string \\}\\s*Returns: \\{ error_code: string \\| null; outcome: string \\}\\[\\]`,
      ),
    );
  }
  assert.doesNotMatch(
    generatedTypesSource,
    /process_billing_subscription_(?:created|updated)_v2:[\s\S]{0,180}p_environment/,
  );
});

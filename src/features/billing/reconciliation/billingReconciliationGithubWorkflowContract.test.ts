import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/billing-reconciliation-sandbox.yml",
  "utf8",
);

test("workflow is manual-only with minimal token permissions and serialized runs", () => {
  assert.match(workflow, /^on:\s*\r?\n\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(schedule|push|pull_request|repository_dispatch):/m);
  assert.match(workflow, /^permissions:\s*\{\}\s*$/m);
  assert.match(workflow, /group:\s*billing-reconciliation-sandbox/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /expected_status:/);
  assert.match(workflow, /default:\s*"503"/);
  assert.match(workflow, /-\s*"503"/);
  assert.match(workflow, /-\s*"200"/);
});

test("workflow uses only the approved variable, secrets and headers", () => {
  assert.match(workflow, /vars\.BILLING_RECONCILIATION_URL/);
  assert.match(workflow, /secrets\.BILLING_RECONCILIATION_SECRET/);
  assert.match(workflow, /secrets\.VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(workflow, /Authorization:\s*Bearer \$\{RECONCILIATION_SECRET\}/);
  assert.match(workflow, /x-vercel-protection-bypass:\s*\$\{VERCEL_BYPASS_SECRET\}/);
  assert.doesNotMatch(workflow, /x-vercel-set-bypass-cookie/i);
  assert.doesNotMatch(workflow, /SUPABASE_(SERVICE_ROLE|KEY)|BILLING_WORKER_SECRET/);
  assert.doesNotMatch(workflow, /https:\/\/[a-z0-9-]+\.vercel\.app/i);
});

test("request is a bounded zero-body POST without verbose or retry behavior", () => {
  assert.match(workflow, /--request POST/);
  assert.match(workflow, /Content-Length:\s*0/);
  assert.match(workflow, /--max-time\s+70/);
  assert.doesNotMatch(workflow, /(^|\s)(--data|-d|--form|-F|--json)(\s|=)/m);
  assert.doesNotMatch(workflow, /curl\s+[^\n]*(--verbose|-v)|set\s+-x|--retry/i);
  assert.doesNotMatch(workflow, /\?[^\s"']*(secret|token|key)=/i);
  assert.doesNotMatch(workflow, /actions\/checkout|uses:/);
});

test("target validation and response output are fail-closed and allowlisted", () => {
  assert.match(workflow, /target\.protocol !== "https:"/);
  assert.match(workflow, /target\.username !== ""/);
  assert.match(workflow, /target\.password !== ""/);
  assert.match(workflow, /target\.search !== ""/);
  assert.match(workflow, /target\.hash !== ""/);
  assert.match(workflow, /\.endsWith\("\.vercel\.app"\)/);
  assert.match(workflow, /\/api\/internal\/billing\/reconcile-linked-subscriptions/);
  assert.match(workflow, /http_status" != "\$EXPECTED_STATUS/);
  for (const field of [
    "claimed",
    "inSync",
    "remoteNewerEquivalent",
    "driftDetected",
    "manualReview",
    "providerUnavailable",
    "configurationError",
    "claimLost",
  ]) assert.match(workflow, new RegExp(`"${field}"`));
  assert.match(workflow, /trap cleanup EXIT/);
  assert.match(workflow, /rm -f "\$response_file"/);
  assert.doesNotMatch(workflow, /cat\s+"?\$response_file|response\.headers|curl.*--include/i);
});

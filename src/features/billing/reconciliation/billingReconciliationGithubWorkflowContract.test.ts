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
  assert.match(workflow, /remaining_seconds=\$\(\(70 - SECONDS\)\)/);
  assert.match(workflow, /--max-time "\$remaining_seconds"/);
  assert.doesNotMatch(workflow, /(^|\s)(--data|-d|--form|-F|--json)(\s|=)/m);
  assert.doesNotMatch(workflow, /curl\s+[^\n]*(--verbose|-v)|set\s+-x|--retry/i);
  assert.doesNotMatch(workflow, /--location(?:-trusted)?|(^|\s)-L(?:\s|$)/m);
  assert.doesNotMatch(workflow, /\?[^\s"']*(secret|token|key)=/i);
  assert.doesNotMatch(workflow, /actions\/checkout|uses:/);
  assert.equal((workflow.match(/perform_request "/g) ?? []).length, 2);
});

test("target validation and response output are fail-closed and allowlisted", () => {
  assert.match(workflow, /from urllib\.parse import urljoin, urlsplit/);
  assert.match(workflow, /from email\.parser import BytesParser/);
  assert.match(workflow, /target\.scheme != "https"/);
  assert.match(workflow, /target\.username is not None/);
  assert.match(workflow, /target\.password is not None/);
  assert.match(workflow, /target_port is not None/);
  assert.match(workflow, /target\.query/);
  assert.match(workflow, /target\.fragment/);
  assert.match(workflow, /marker = "-git-billing-webhook-sandbox-"/);
  assert.match(workflow, /same_project_namespace/);
  assert.match(workflow, /target_label\.startswith\(project \+ "-"\)/);
  assert.match(workflow, /target_label\.endswith\("-" \+ team\)/);
  assert.match(workflow, /\/api\/internal\/billing\/reconcile-linked-subscriptions/);
  assert.match(workflow, /301\|302\|307\|308/);
  assert.match(workflow, /second_status.*perform_request/);
  assert.match(workflow, /second_status" =~ \^3\[0-9\]\[0-9\]\$/);
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
  for (const file of ["first_body_file", "first_header_file", "second_body_file", "second_header_file", "redirect_target_file"])
    assert.match(workflow, new RegExp(`"\\$${file}"`));
  assert.doesNotMatch(workflow, /cat\s+"?\$(response|first_header|second_header)_file|response\.headers|curl.*--include/i);
  assert.doesNotMatch(workflow, /echo.*(redirect_url|Location|target_host|target\.geturl)/i);
});

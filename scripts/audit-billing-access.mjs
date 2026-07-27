import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef) {
  console.error("SUPABASE_PROJECT_REF is required.");
  process.exit(1);
}

let accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  try {
    accessToken = readFileSync(resolve(homedir(), ".supabase", "access-token"), "utf8").trim();
  } catch {
    console.error("Supabase CLI access token is not configured.");
    process.exit(1);
  }
}

const query = readFileSync(
  resolve("supabase", "snippets", "billing_access_override_audit.sql"),
  "utf8",
);
const response = await fetch(
  `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  },
);

if (!response.ok) {
  console.error(`Billing access audit failed with HTTP ${response.status}.`);
  process.exit(1);
}

const rows = await response.json();
const result = rows?.[0];
if (!result) {
  console.error("Billing access audit returned an unexpected response.");
  process.exit(1);
}

console.log(`Legacy active subscriptions without period: ${result.legacy_active_without_period}`);
console.log(`Total billing overrides: ${result.total_billing_overrides}`);
console.log(`Active billing overrides: ${result.active_billing_overrides}`);

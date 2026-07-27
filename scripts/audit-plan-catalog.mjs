import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef) throw new Error("SUPABASE_PROJECT_REF is required.");
let accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) accessToken = readFileSync(resolve(homedir(), ".supabase", "access-token"), "utf8").trim();
const query = readFileSync(resolve("supabase", "snippets", "plan_catalog_preflight.sql"), "utf8");
const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Plan audit failed with HTTP ${response.status}.`);
const rows = await response.json();
const result = rows?.[0]?.jsonb_build_object;
if (!result) throw new Error("Plan audit returned an unexpected response.");
console.log(JSON.stringify(result, null, 2));

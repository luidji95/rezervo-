// Operator billing recovery (one target per call, dry-run by default).
//   node --experimental-strip-types scripts/billing-recovery.mjs event --event <uuid>
//   node --experimental-strip-types scripts/billing-recovery.mjs subscription --subscription <uuid>
//   node --experimental-strip-types scripts/billing-recovery.mjs plan-change --change <uuid>   (C2, migration 048)
// See docs/billing-operator-recovery-runbook.md. Credentials and the billing environment come only
// from the operator shell environment; they are never accepted as arguments and never printed.
import { createClient } from "@supabase/supabase-js";
import { RECOVERY_USAGE, RecoveryUsageError, parseRecoveryArgs } from "../src/features/billing/recovery/billingRecoveryArgs.ts";
import { BillingRecoveryConfigError, resolveBillingRecoveryConfig } from "../src/features/billing/recovery/billingRecoveryConfig.ts";
import { formatRecoveryReport, runBillingRecovery } from "../src/features/billing/recovery/billingRecoveryCore.ts";
import { SupabaseBillingRecoveryRepository } from "../src/features/billing/recovery/supabaseBillingRecoveryRepository.ts";
import { LemonSqueezyReconciliationProvider } from "../src/features/billing/reconciliation/lemonSqueezyReconciliationProvider.ts";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

let command;
try {
  command = parseRecoveryArgs(process.argv.slice(2));
} catch (error) {
  if (error instanceof RecoveryUsageError) fail(`${error.message}\n\n${RECOVERY_USAGE}`);
  throw error;
}

let config;
try {
  config = resolveBillingRecoveryConfig(process.env);
} catch (error) {
  if (error instanceof BillingRecoveryConfigError) {
    fail("Billing operator recovery is not enabled or not configured for this environment (see the runbook).");
  }
  throw error;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) fail("Database service credentials are not configured in this shell.");

const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const result = await runBillingRecovery({
  command,
  environment: config.environment,
  storeId: config.storeId,
  repository: new SupabaseBillingRecoveryRepository(client),
  provider: new LemonSqueezyReconciliationProvider(config.apiKey),
});

console.log(formatRecoveryReport(result, "node --experimental-strip-types scripts/billing-recovery.mjs"));
process.exit(result.exitCode);

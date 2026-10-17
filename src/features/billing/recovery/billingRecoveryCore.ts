import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type { NormalizedLemonSqueezySubscription } from "../lemonSqueezy/lemonSqueezySubscriptionObjectCore.ts";
import { BillingReconciliationProviderError, type BillingReconciliationProvider } from "../reconciliation/billingReconciliationProvider.ts";
import type { RecoveryApply, RecoveryCommand } from "./billingRecoveryArgs.ts";

export type RecoveryPlan = {
  verdict: string;
  errorCode: string | null;
  reviewToken: string | null;
  details: Record<string, string>;
};
export type RecoveryApplyResult = { outcome: string; errorCode: string | null };

export interface BillingRecoveryRepository {
  getLinkedSubscription(subscriptionId: string, environment: BillingEnvironment): Promise<{ providerSubscriptionId: string } | null>;
  planEventReprocess(environment: BillingEnvironment, eventId: string): Promise<RecoveryPlan>;
  applyEventReprocess(environment: BillingEnvironment, eventId: string, apply: RecoveryApply): Promise<RecoveryApplyResult>;
  planSnapshot(environment: BillingEnvironment, subscriptionId: string, snapshot: NormalizedLemonSqueezySubscription): Promise<RecoveryPlan>;
  applySnapshot(environment: BillingEnvironment, subscriptionId: string, snapshot: NormalizedLemonSqueezySubscription, apply: RecoveryApply): Promise<RecoveryApplyResult>;
}

export type RecoveryReport = {
  mode: "dry-run" | "apply";
  target: { kind: "event" | "subscription"; id: string };
  environment: BillingEnvironment;
  /** dry-run verdict or apply outcome */
  status: string;
  errorCode: string | null;
  reviewToken: string | null;
  details: Record<string, string>;
  /** 0 = ok / no action needed, 2 = rejected or needs a new review, 3 = operational failure */
  exitCode: 0 | 2 | 3;
};

const OK_DRY_RUN = new Set(["eligible", "no_change", "already_processed"]);
const OK_APPLY = new Set(["applied", "reprocessed", "no_change", "dependency_pending"]);

function report(
  command: RecoveryCommand,
  environment: BillingEnvironment,
  status: string,
  errorCode: string | null,
  extra: Partial<Pick<RecoveryReport, "reviewToken" | "details" | "exitCode">> = {},
): RecoveryReport {
  const mode = command.apply ? "apply" : "dry-run";
  const ok = mode === "apply" ? OK_APPLY.has(status) : OK_DRY_RUN.has(status);
  return {
    mode,
    target: { kind: command.kind, id: command.targetId },
    environment,
    status,
    errorCode,
    reviewToken: extra.reviewToken ?? null,
    details: extra.details ?? {},
    exitCode: extra.exitCode ?? (ok ? 0 : 2),
  };
}

function operational(command: RecoveryCommand, environment: BillingEnvironment, code: string) {
  return report(command, environment, "operational_failure", code, { exitCode: 3 });
}

function providerFailureCode(error: unknown) {
  if (error instanceof BillingReconciliationProviderError) return error.kind;
  return "provider_unavailable";
}

/**
 * One recovery step for one target. The database RPCs are the authority: they re-validate identity,
 * environment parity, ordering and the review token under lock. This function only gathers evidence
 * (a provider snapshot, retrieved outside any database transaction) and shapes a sanitized report.
 */
export async function runBillingRecovery(input: {
  command: RecoveryCommand;
  environment: BillingEnvironment;
  storeId: string;
  repository: BillingRecoveryRepository;
  provider: BillingReconciliationProvider;
}): Promise<RecoveryReport> {
  const { command, environment, repository } = input;
  try {
    if (command.kind === "event") {
      if (!command.apply) {
        const plan = await repository.planEventReprocess(environment, command.targetId);
        return report(command, environment, plan.verdict, plan.errorCode, { reviewToken: plan.reviewToken, details: plan.details });
      }
      const result = await repository.applyEventReprocess(environment, command.targetId, command.apply);
      return report(command, environment, result.outcome, result.errorCode);
    }

    const local = await repository.getLinkedSubscription(command.targetId, environment);
    if (!local) return report(command, environment, "not_found", "recovery_subscription_not_found");

    let snapshot: NormalizedLemonSqueezySubscription;
    try {
      snapshot = (await input.provider.retrieveSubscription(local.providerSubscriptionId)).snapshot;
    } catch (error) {
      return operational(command, environment, providerFailureCode(error));
    }
    // Environment, store and subscription identity of the evidence are checked here as well as in the database.
    if (snapshot.providerSubscriptionId !== local.providerSubscriptionId
      || snapshot.providerStoreId !== input.storeId
      || snapshot.testMode !== (environment === "test")) {
      return report(command, environment, "identity_conflict", "recovery_snapshot_identity_conflict");
    }

    if (!command.apply) {
      const plan = await repository.planSnapshot(environment, command.targetId, snapshot);
      return report(command, environment, plan.verdict, plan.errorCode, { reviewToken: plan.reviewToken, details: plan.details });
    }
    const result = await repository.applySnapshot(environment, command.targetId, snapshot, command.apply);
    return report(command, environment, result.outcome, result.errorCode);
  } catch {
    return operational(command, environment, "database_error");
  }
}

function line(label: string, value: string | null | undefined) {
  return value === null || value === undefined || value === "" ? null : `${label}: ${value}`;
}

/** Human-readable output. It carries no credentials, payloads, customer identifiers or URLs. */
export function formatRecoveryReport(result: RecoveryReport, binary = "billing-recovery") {
  const lines = [
    line("Environment", `${result.environment} (trusted server configuration)`),
    line("Target", `${result.target.kind} ${result.target.id}`),
    line("Mode", result.mode === "dry-run" ? "DRY-RUN (nothing was changed)" : "APPLY"),
    line(result.mode === "dry-run" ? "Verdict" : "Outcome", result.status),
    line("Code", result.errorCode),
    ...Object.entries(result.details).map(([key, value]) => line(key, value)),
    line("Review token", result.reviewToken),
  ];
  if (result.mode === "dry-run" && result.status === "eligible" && result.reviewToken) {
    const flag = result.target.kind === "event" ? "--event" : "--subscription";
    lines.push(`To apply after review: ${binary} ${result.target.kind} ${flag} ${result.target.id} --apply --review-token ${result.reviewToken} --ticket <ref> --reason "<why>" --operator <label>`);
  }
  if (result.status === "stale") lines.push("The state or the provider evidence changed after the dry-run. Run the dry-run again and review the new proposal.");
  return lines.filter((value): value is string => value !== null).join("\n");
}

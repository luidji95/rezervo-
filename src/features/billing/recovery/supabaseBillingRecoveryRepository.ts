import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type { NormalizedLemonSqueezySubscription } from "../lemonSqueezy/lemonSqueezySubscriptionObjectCore.ts";
import type { RecoveryApply } from "./billingRecoveryArgs.ts";
import type { BillingRecoveryRepository, RecoveryApplyResult, RecoveryPlan } from "./billingRecoveryCore.ts";

type RpcResult = PromiseLike<{ data: unknown; error: unknown }>;
/** The subset of a service-role Supabase client this repository needs. */
export interface RecoveryDatabaseClient {
  rpc(name: string, args: Record<string, unknown>): RpcResult;
  from(table: "subscriptions"): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): { maybeSingle(): RpcResult };
        };
      };
    };
  };
}

function singleRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("BILLING_RECOVERY_RPC_RESPONSE_INVALID");
  return row as Record<string, unknown>;
}
const text = (value: unknown) => (typeof value === "string" ? value : null);
const show = (value: unknown) => (value === null || value === undefined ? "none" : String(value));

function snapshotArgs(environment: BillingEnvironment, subscriptionId: string, s: NormalizedLemonSqueezySubscription) {
  return {
    p_environment: environment,
    p_subscription_id: subscriptionId,
    p_provider_subscription_id: s.providerSubscriptionId,
    p_provider_customer_id: s.providerCustomerId,
    p_provider_store_id: s.providerStoreId,
    p_test_mode: s.testMode,
    p_provider_product_id: s.providerProductId,
    p_provider_variant_id: s.providerVariantId,
    p_provider_status: s.providerStatus,
    p_provider_cancelled: s.providerCancelled,
    p_provider_pause_mode: s.providerPauseMode,
    p_provider_pause_resumes_at: s.providerPauseResumesAt,
    p_provider_trial_ends_at: s.providerTrialEndsAt,
    p_provider_renews_at: s.providerRenewsAt,
    p_provider_ends_at: s.providerEndsAt,
    p_provider_created_at: s.providerCreatedAt,
    p_provider_updated_at: s.providerUpdatedAt,
  };
}

export class SupabaseBillingRecoveryRepository implements BillingRecoveryRepository {
  private readonly client: RecoveryDatabaseClient;

  constructor(client: RecoveryDatabaseClient) {
    this.client = client;
  }

  private async call(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw new Error("BILLING_RECOVERY_RPC_FAILED");
    return singleRow(data);
  }

  async getLinkedSubscription(subscriptionId: string, environment: BillingEnvironment) {
    const { data, error } = await this.client.from("subscriptions")
      .select("provider_subscription_id")
      .eq("id", subscriptionId).eq("billing_provider", "lemonsqueezy").eq("billing_environment", environment)
      .maybeSingle();
    if (error) throw new Error("BILLING_RECOVERY_LOOKUP_FAILED");
    const id = text((data as { provider_subscription_id?: unknown } | null)?.provider_subscription_id);
    return id && id.trim() ? { providerSubscriptionId: id } : null;
  }

  async planEventReprocess(environment: BillingEnvironment, eventId: string): Promise<RecoveryPlan> {
    const row = await this.call("plan_billing_event_reprocess_v1", { p_environment: environment, p_webhook_event_id: eventId });
    return {
      verdict: text(row.verdict) ?? "unknown",
      errorCode: text(row.error_code),
      reviewToken: text(row.review_token),
      details: {
        "Event name": show(row.event_name),
        "Prior reason": show(row.prior_error_code),
        "Attempts so far": show(row.attempt_count),
      },
    };
  }

  async applyEventReprocess(environment: BillingEnvironment, eventId: string, apply: RecoveryApply): Promise<RecoveryApplyResult> {
    const row = await this.call("apply_billing_event_reprocess_v1", {
      p_environment: environment, p_webhook_event_id: eventId, p_review_token: apply.reviewToken,
      p_ticket_ref: apply.ticket, p_reason: apply.reason, p_operator_label: apply.operator,
    });
    return { outcome: text(row.outcome) ?? "unknown", errorCode: text(row.error_code) };
  }

  async planSnapshot(environment: BillingEnvironment, subscriptionId: string, snapshot: NormalizedLemonSqueezySubscription): Promise<RecoveryPlan> {
    const row = await this.call("plan_billing_subscription_recovery_v1", snapshotArgs(environment, subscriptionId, snapshot));
    const proposed = text(row.verdict) === "eligible" || text(row.verdict) === "no_change";
    return {
      verdict: text(row.verdict) ?? "unknown",
      errorCode: text(row.error_code),
      reviewToken: text(row.review_token),
      details: {
        "Current": `status=${show(row.local_status)} period_end=${show(row.local_period_ends_at)} cancel_at_period_end=${show(row.local_cancel_at_period_end)} state_updated_at=${show(row.local_provider_state_updated_at)}`,
        ...(proposed ? { "Proposed": `status=${show(row.proposed_status)} period_end=${show(row.proposed_period_ends_at)} cancel_at_period_end=${show(row.proposed_cancel_at_period_end)} cancelled_at=${show(row.proposed_cancelled_at)}` } : {}),
        "Evidence": `operator provider snapshot, provider updated_at=${snapshot.providerUpdatedAt}, fingerprint=${show(row.evidence_fingerprint).slice(0, 12)}`,
      },
    };
  }

  async applySnapshot(environment: BillingEnvironment, subscriptionId: string, snapshot: NormalizedLemonSqueezySubscription, apply: RecoveryApply): Promise<RecoveryApplyResult> {
    const row = await this.call("apply_billing_subscription_recovery_v1", {
      ...snapshotArgs(environment, subscriptionId, snapshot),
      p_review_token: apply.reviewToken, p_ticket_ref: apply.ticket, p_reason: apply.reason, p_operator_label: apply.operator,
    });
    return { outcome: text(row.outcome) ?? "unknown", errorCode: text(row.error_code) };
  }
}

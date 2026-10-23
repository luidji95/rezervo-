import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import {
  PlanChangeDatabaseRejection,
  type BillingPlanChangeRepository,
  type PlanChangePrepareRow,
  type PlanChangeProviderEvidence,
  type PlanChangeRecord,
  type PlanChangeStatus,
  type PlanChangeTarget,
} from "./billingPlanChangeCore.ts";

type QueryResult = PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
type Filterable = {
  eq(column: string, value: unknown): Filterable;
  order(column: string, options: { ascending: boolean }): Filterable;
  limit(count: number): QueryResult;
};
/** Minimal service-role client surface used by the repository (supabase-js compatible). */
export type PlanChangeDatabaseClient = {
  rpc(name: string, args: Record<string, unknown>): QueryResult;
  from(table: string): { select(columns: string): Filterable };
};

// Only a stable code raised by the RPC (P0001) is a refusal; every other failure is unknown.
const REJECTION_CODE = /^(?:BILLING|EMPLOYEE)_[A-Z_]+$/;
const STATUSES = new Set<PlanChangeStatus>(["requested", "unknown", "confirmed", "manual_review", "completed", "not_applied", "abandoned"]);

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}
const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

function evidenceArgs(evidence: PlanChangeProviderEvidence | null) {
  return {
    p_provider_subscription_id: evidence?.providerSubscriptionId ?? null,
    p_provider_customer_id: evidence?.providerCustomerId ?? null,
    p_provider_store_id: evidence?.providerStoreId ?? null,
    p_test_mode: evidence?.testMode ?? null,
    p_provider_product_id: evidence?.providerProductId ?? null,
    p_provider_variant_id: evidence?.providerVariantId ?? null,
    p_provider_status: evidence?.providerStatus ?? null,
    p_provider_cancelled: evidence?.providerCancelled ?? null,
    p_provider_pause_mode: evidence?.providerPauseMode ?? null,
    p_provider_trial_ends_at: evidence?.providerTrialEndsAt ?? null,
    p_provider_renews_at: evidence?.providerRenewsAt ?? null,
    p_provider_ends_at: evidence?.providerEndsAt ?? null,
    p_provider_updated_at: evidence?.providerUpdatedAt ?? null,
  };
}

export class SupabaseBillingPlanChangeRepository implements BillingPlanChangeRepository {
  private readonly client: PlanChangeDatabaseClient;

  constructor(client: PlanChangeDatabaseClient) { this.client = client; }

  async findOwnedSalon(userId: string) {
    const { data, error } = await this.client.from("salons").select("id").eq("owner_id", userId).limit(2);
    if (error || !Array.isArray(data)) throw new Error("BILLING_PLAN_CHANGE_OWNER_LOOKUP_FAILED");
    if (data.length === 0) return "forbidden" as const;
    return data.length === 1 ? text((data[0] as Record<string, unknown>).id) : null;
  }

  async findActivePlanId(slug: PlanChangeTarget) {
    const { data, error } = await this.client.from("plans").select("id").eq("slug", slug).eq("is_active", true).limit(2);
    if (error || !Array.isArray(data)) throw new Error("BILLING_PLAN_CHANGE_PLAN_LOOKUP_FAILED");
    return data.length === 1 ? text((data[0] as Record<string, unknown>).id) : null;
  }

  async findProviderCustomerId(subscriptionId: string) {
    const { data, error } = await this.client.from("subscriptions").select("provider_customer_id").eq("id", subscriptionId).limit(2);
    if (error || !Array.isArray(data)) throw new Error("BILLING_PLAN_CHANGE_SUBSCRIPTION_LOOKUP_FAILED");
    return data.length === 1 ? text((data[0] as Record<string, unknown>).provider_customer_id) : null;
  }

  async prepare(input: { salonId: string; actorProfileId: string; targetPlanId: string; now: string }): Promise<PlanChangePrepareRow> {
    const { data, error } = await this.client.rpc("prepare_billing_plan_change_v1", {
      p_salon_id: input.salonId, p_actor_profile_id: input.actorProfileId, p_target_plan_id: input.targetPlanId, p_now: input.now,
    });
    const row = firstRow(data);
    if (error || !row || (row.outcome !== "eligible" && row.outcome !== "rejected")) throw new Error("BILLING_PLAN_CHANGE_PREPARE_FAILED");
    return {
      outcome: row.outcome, errorCode: text(row.error_code), subscriptionId: text(row.subscription_id),
      providerSubscriptionId: text(row.provider_subscription_id), baselinePeriodEnd: text(row.baseline_period_end),
      targetProviderVariantId: text(row.target_provider_variant_id), stateToken: text(row.state_token),
    };
  }

  async request(input: { salonId: string; actorProfileId: string; targetPlanId: string; stateToken: string; evidence: PlanChangeProviderEvidence; checkedAt: string; now: string }) {
    const { data, error } = await this.client.rpc("request_billing_plan_change_v1", {
      p_salon_id: input.salonId, p_actor_profile_id: input.actorProfileId, p_target_plan_id: input.targetPlanId,
      p_state_token: input.stateToken, ...evidenceArgs(input.evidence),
      p_provider_checked_at: input.checkedAt, p_now: input.now,
    });
    if (error) {
      const message = error.message ?? "";
      if (error.code === "P0001" && REJECTION_CODE.test(message)) throw new PlanChangeDatabaseRejection(message);
      throw new Error("BILLING_PLAN_CHANGE_REQUEST_OUTCOME_UNKNOWN");
    }
    const row = firstRow(data);
    const planChangeId = text(row?.plan_change_id);
    const targetProviderVariantId = text(row?.target_provider_variant_id);
    if (row?.outcome !== "requested" || !planChangeId || !targetProviderVariantId) throw new Error("BILLING_PLAN_CHANGE_REQUEST_OUTCOME_UNKNOWN");
    return { planChangeId, targetProviderVariantId };
  }

  async record(input: { environment: BillingEnvironment; planChangeId: string; result: "accepted" | "ambiguous" | "observed"; evidence: PlanChangeProviderEvidence | null; now: string }) {
    const { data, error } = await this.client.rpc("record_billing_plan_change_provider_result_v1", {
      p_environment: input.environment, p_plan_change_id: input.planChangeId, p_result: input.result,
      ...evidenceArgs(input.evidence), p_now: input.now,
    });
    const row = firstRow(data);
    if (error || !row || typeof row.outcome !== "string" || row.outcome === "environment_mismatch" || row.outcome === "not_found") {
      throw new Error("BILLING_PLAN_CHANGE_RECORD_FAILED");
    }
  }

  async evaluate(input: { environment: BillingEnvironment; subscriptionId: string; now: string }) {
    const { data, error } = await this.client.rpc("evaluate_billing_plan_change_v1", {
      p_environment: input.environment, p_subscription_id: input.subscriptionId, p_now: input.now,
    });
    const row = firstRow(data);
    if (error || !row || row.outcome === "environment_mismatch" || row.outcome === "not_found") throw new Error("BILLING_PLAN_CHANGE_EVALUATE_FAILED");
  }

  async latestChange(salonId: string): Promise<PlanChangeRecord | null> {
    // E1: only changes of the current provider identity; a superseded subscription's terminal change
    // (abandoned at expiry) is history and must not be presented for the new subscription.
    const { data: subscriptions, error: subscriptionError } = await this.client.from("subscriptions")
      .select("provider_subscription_id").eq("salon_id", salonId).limit(1);
    if (subscriptionError || !Array.isArray(subscriptions)) throw new Error("BILLING_PLAN_CHANGE_LOOKUP_FAILED");
    const currentProviderSubscriptionId = text((subscriptions[0] as Record<string, unknown> | undefined)?.provider_subscription_id);
    if (!currentProviderSubscriptionId) return null;
    const { data, error } = await this.client.from("billing_subscription_plan_changes")
      .select("id,subscription_id,provider_subscription_id,provider_customer_id,status,direction,target_plan_id,baseline_period_end,conflict_code")
      .eq("salon_id", salonId).eq("provider_subscription_id", currentProviderSubscriptionId)
      .order("created_at", { ascending: false }).limit(1);
    if (error || !Array.isArray(data)) throw new Error("BILLING_PLAN_CHANGE_LOOKUP_FAILED");
    const row = data[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const status = row.status as PlanChangeStatus;
    const id = text(row.id); const subscriptionId = text(row.subscription_id);
    const providerSubscriptionId = text(row.provider_subscription_id); const baselinePeriodEnd = text(row.baseline_period_end);
    const providerCustomerId = text(row.provider_customer_id);
    if (!id || !subscriptionId || !providerSubscriptionId || !providerCustomerId || !baselinePeriodEnd || !STATUSES.has(status)
        || (row.direction !== "upgrade" && row.direction !== "downgrade")) {
      throw new Error("BILLING_PLAN_CHANGE_LOOKUP_FAILED");
    }
    const { data: plans, error: planError } = await this.client.from("plans").select("slug").eq("id", row.target_plan_id).limit(1);
    if (planError || !Array.isArray(plans)) throw new Error("BILLING_PLAN_CHANGE_LOOKUP_FAILED");
    const slug = (plans[0] as Record<string, unknown> | undefined)?.slug;
    return {
      id, subscriptionId, providerSubscriptionId, providerCustomerId, status, direction: row.direction,
      targetPlan: slug === "starter" || slug === "pro" ? slug : null,
      baselinePeriodEnd, conflictCode: text(row.conflict_code),
    };
  }
}

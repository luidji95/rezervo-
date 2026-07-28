import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";

import type {
  BillingWebhookEventInput,
  BillingWebhookEventRepository,
} from "./lemonSqueezyWebhookCore";

export class SupabaseBillingWebhookEventRepository
  implements BillingWebhookEventRepository
{
  async insertEvent(input: BillingWebhookEventInput) {
    const { data, error } = await supabaseServer
      .rpc("ingest_billing_webhook_event_v2", {
        p_provider: input.provider,
        p_environment: input.environment,
        p_event_name: input.eventName,
        p_provider_object_type: input.providerObjectType,
        p_provider_object_id: input.providerObjectId,
        p_payload_hash: input.payloadHash,
        p_semantic_fingerprint: input.semanticFingerprint,
        p_processing_status: input.processingStatus,
        p_processed_at: input.processedAt,
        p_has_subscription_facts: input.subscriptionFacts !== null,
        p_checkout_session_id: input.subscriptionFacts?.checkoutSessionId ?? null,
        p_custom_salon_id: input.subscriptionFacts?.customSalonId ?? null,
        p_custom_plan_code: input.subscriptionFacts?.customPlanCode ?? null,
        p_custom_idempotency_key: input.subscriptionFacts?.customIdempotencyKey ?? null,
        p_provider_subscription_id: input.subscriptionFacts?.providerSubscriptionId ?? null,
        p_provider_order_id: input.subscriptionFacts?.providerOrderId ?? null,
        p_provider_customer_id: input.subscriptionFacts?.providerCustomerId ?? null,
        p_provider_product_id: input.subscriptionFacts?.providerProductId ?? null,
        p_provider_variant_id: input.subscriptionFacts?.providerVariantId ?? null,
        p_provider_status: input.subscriptionFacts?.providerStatus ?? null,
        p_provider_created_at: input.subscriptionFacts?.providerCreatedAt ?? null,
        p_provider_updated_at: input.subscriptionFacts?.providerUpdatedAt ?? null,
        p_test_mode: input.testMode,
        p_correlation_status: input.subscriptionFacts?.correlationStatus ?? null,
        p_correlation_error_code: input.subscriptionFacts?.correlationErrorCode ?? null,
        p_provider_store_id: input.subscriptionFacts?.providerStoreId ?? null,
        p_provider_renews_at: input.subscriptionFacts?.providerRenewsAt ?? null,
        p_provider_ends_at: input.subscriptionFacts?.providerEndsAt ?? null,
        p_provider_cancelled: input.subscriptionFacts?.providerCancelled ?? null,
        p_provider_trial_ends_at: input.subscriptionFacts?.providerTrialEndsAt ?? null,
        p_provider_pause_mode: input.subscriptionFacts?.providerPauseMode ?? null,
        p_provider_pause_resumes_at: input.subscriptionFacts?.providerPauseResumesAt ?? null,
      })
      .single();

    const row = data as {
      event_id: string;
      outcome: string;
      stored_status: string;
    } | null;
    if (error || !row) throw new Error("BILLING_WEBHOOK_STORAGE_FAILED");
    if (row.outcome !== "duplicate" && row.outcome !== "inserted") {
      throw new Error("BILLING_WEBHOOK_STORAGE_FAILED");
    }
    return {
      outcome: row.outcome,
      id: row.event_id,
      storedStatus: row.stored_status,
    } as const;
  }

  async processSubscriptionCreated(eventId: string) {
    const { data, error } = await supabaseServer
      .rpc("process_billing_subscription_created_v1", {
        p_webhook_event_id: eventId,
      })
      .single();
    const row = data as { outcome: string; error_code: string | null } | null;
    if (error || !row || ![
      "processed", "already_processed", "stale_ignored", "manual_review",
    ].includes(row.outcome)) {
      throw new Error("BILLING_WEBHOOK_STORAGE_FAILED");
    }
    return { outcome: row.outcome } as {
      outcome: "processed" | "already_processed" | "stale_ignored" | "manual_review";
    };
  }

  async processSubscriptionUpdated(eventId: string) {
    const { data, error } = await supabaseServer
      .rpc("process_billing_subscription_updated_v1", {
        p_webhook_event_id: eventId,
      })
      .single();
    const row = data as { outcome: string; error_code: string | null } | null;
    const outcomes = [
      "processed", "already_processed", "already_applied", "stale_ignored",
      "manual_review", "dependency_pending",
    ] as const;
    if (error || !row || !outcomes.includes(row.outcome as typeof outcomes[number])) {
      throw new Error("BILLING_WEBHOOK_STORAGE_FAILED");
    }
    return { outcome: row.outcome } as {
      outcome: typeof outcomes[number];
    };
  }
}

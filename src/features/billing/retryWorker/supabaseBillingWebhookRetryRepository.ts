import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { SupabaseBillingWebhookEventRepository } from "../webhooks/supabaseBillingWebhookEventRepository";
import type { BillingWebhookFinalizerOutcome, BillingWebhookRetryRepository, BillingWebhookWorkerOutcome, ClaimedBillingWebhookEvent } from "./billingWebhookRetryWorkerCore";
import type { BillingEnvironment } from "../config/billingEnvironment";

export class SupabaseBillingWebhookRetryRepository implements BillingWebhookRetryRepository {
  private readonly processorRepository = new SupabaseBillingWebhookEventRepository();
  constructor(private readonly environment: BillingEnvironment) {}

  async claimPending(batchSize: number): Promise<ClaimedBillingWebhookEvent[]> {
    const { data, error } = await supabaseServer.rpc("claim_pending_billing_webhook_events_v2", {
      p_environment: this.environment,
      p_batch_size: batchSize,
    });
    if (error || !Array.isArray(data)) throw new Error("BILLING_WORKER_CLAIM_FAILED");
    return data.map((row) => ({
      webhookEventId: row.webhook_event_id,
      eventName: row.event_name as ClaimedBillingWebhookEvent["eventName"],
      environment: row.environment as BillingEnvironment,
      claimToken: row.claim_token,
    }));
  }

  processSubscriptionCreated(eventId: string) {
    return this.processorRepository.processSubscriptionCreated(eventId);
  }

  processSubscriptionUpdated(eventId: string) {
    return this.processorRepository.processSubscriptionUpdated(eventId);
  }

  async finalize(input: { eventId: string; claimToken: string; workerOutcome: BillingWebhookWorkerOutcome }): Promise<BillingWebhookFinalizerOutcome> {
    const { data, error } = await supabaseServer.rpc("finalize_billing_webhook_processing_attempt_v1", {
      p_webhook_event_id: input.eventId,
      p_claim_token: input.claimToken,
      p_worker_outcome: input.workerOutcome,
    }).single();
    const row = data as { outcome: BillingWebhookFinalizerOutcome } | null;
    if (error || !row || !["finalized_terminal", "retry_scheduled", "retry_exhausted", "claim_lost", "manual_review"].includes(row.outcome)) {
      throw new Error("BILLING_WORKER_FINALIZE_FAILED");
    }
    return row.outcome;
  }
}

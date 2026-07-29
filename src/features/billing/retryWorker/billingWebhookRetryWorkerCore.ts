export const BILLING_WEBHOOK_PROCESSOR_OUTCOMES = [
  "processed", "already_processed", "already_applied", "stale_ignored",
  "manual_review", "dependency_pending",
] as const;

export type BillingWebhookProcessorOutcome = typeof BILLING_WEBHOOK_PROCESSOR_OUTCOMES[number];
export type BillingWebhookWorkerOutcome = BillingWebhookProcessorOutcome | "transient_error" | "unknown_outcome";
export type BillingWebhookFinalizerOutcome = "finalized_terminal" | "retry_scheduled" | "retry_exhausted" | "claim_lost" | "manual_review";

export type ClaimedBillingWebhookEvent = {
  webhookEventId: string;
  eventName: "subscription_created" | "subscription_updated";
  claimToken: string;
};

export type BillingWebhookRetrySummary = {
  claimed: number;
  processed: number;
  alreadyTerminal: number;
  retried: number;
  manualReview: number;
  claimLost: number;
};

export interface BillingWebhookRetryRepository {
  claimPending(batchSize: number): Promise<ClaimedBillingWebhookEvent[]>;
  processSubscriptionCreated(eventId: string): Promise<{ outcome: string }>;
  processSubscriptionUpdated(eventId: string): Promise<{ outcome: string }>;
  finalize(input: { eventId: string; claimToken: string; workerOutcome: BillingWebhookWorkerOutcome }): Promise<BillingWebhookFinalizerOutcome>;
}

function isProcessorOutcome(value: string): value is BillingWebhookProcessorOutcome {
  return (BILLING_WEBHOOK_PROCESSOR_OUTCOMES as readonly string[]).includes(value);
}

export async function runBillingWebhookRetryWorker(input: {
  repository: BillingWebhookRetryRepository;
  batchSize?: number;
}): Promise<BillingWebhookRetrySummary> {
  const claimed = await input.repository.claimPending(input.batchSize ?? 10);
  const summary: BillingWebhookRetrySummary = { claimed: claimed.length, processed: 0, alreadyTerminal: 0, retried: 0, manualReview: 0, claimLost: 0 };

  for (const event of claimed) {
    let workerOutcome: BillingWebhookWorkerOutcome;
    try {
      const result = event.eventName === "subscription_created"
        ? await input.repository.processSubscriptionCreated(event.webhookEventId)
        : await input.repository.processSubscriptionUpdated(event.webhookEventId);
      workerOutcome = isProcessorOutcome(result.outcome) ? result.outcome : "unknown_outcome";
    } catch {
      workerOutcome = "transient_error";
    }

    let finalizerOutcome: BillingWebhookFinalizerOutcome;
    try {
      finalizerOutcome = await input.repository.finalize({ eventId: event.webhookEventId, claimToken: event.claimToken, workerOutcome });
    } catch {
      summary.claimLost += 1;
      continue;
    }

    if (finalizerOutcome === "retry_scheduled") summary.retried += 1;
    else if (finalizerOutcome === "manual_review" || finalizerOutcome === "retry_exhausted") summary.manualReview += 1;
    else if (finalizerOutcome === "claim_lost") summary.claimLost += 1;
    else if (["already_processed", "already_applied", "stale_ignored"].includes(workerOutcome)) summary.alreadyTerminal += 1;
    else summary.processed += 1;
  }

  return summary;
}

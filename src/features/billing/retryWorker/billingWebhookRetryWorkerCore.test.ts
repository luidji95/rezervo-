import assert from "node:assert/strict";
import test from "node:test";
import { runBillingWebhookRetryWorker, type BillingWebhookFinalizerOutcome, type BillingWebhookRetryRepository, type BillingWebhookWorkerOutcome, type ClaimedBillingWebhookEvent } from "./billingWebhookRetryWorkerCore.ts";

class MemoryRepository implements BillingWebhookRetryRepository {
  readonly calls: string[] = [];
  readonly claimed: ClaimedBillingWebhookEvent[];
  readonly processor: (event: ClaimedBillingWebhookEvent) => Promise<string>;
  readonly finalizer: (outcome: BillingWebhookWorkerOutcome) => Promise<BillingWebhookFinalizerOutcome>;
  active = 0;
  maxActive = 0;
  constructor(
    claimed: ClaimedBillingWebhookEvent[],
    processor: (event: ClaimedBillingWebhookEvent) => Promise<string>,
    finalizer: (outcome: BillingWebhookWorkerOutcome) => Promise<BillingWebhookFinalizerOutcome>,
  ) {
    this.claimed = claimed;
    this.processor = processor;
    this.finalizer = finalizer;
  }
  async claimPending() { return this.claimed; }
  async processSubscriptionCreated(eventId: string) { return this.process("subscription_created", eventId); }
  async processSubscriptionUpdated(eventId: string) { return this.process("subscription_updated", eventId); }
  private async process(name: ClaimedBillingWebhookEvent["eventName"], eventId: string) {
    this.active += 1; this.maxActive = Math.max(this.maxActive, this.active); this.calls.push(`${name}:${eventId}`);
    try { return { outcome: await this.processor(this.claimed.find((event) => event.webhookEventId === eventId)!) }; }
    finally { this.active -= 1; }
  }
  async finalize(input: { workerOutcome: BillingWebhookWorkerOutcome }) { this.calls.push(`finalize:${input.workerOutcome}`); return this.finalizer(input.workerOutcome); }
}

const events: ClaimedBillingWebhookEvent[] = [
  { webhookEventId: "created", eventName: "subscription_created", claimToken: "token-1" },
  { webhookEventId: "updated", eventName: "subscription_updated", claimToken: "token-2" },
];

test("worker processes claimed events sequentially with event-specific processors", async () => {
  const repository = new MemoryRepository(events, async () => { await new Promise((resolve) => setTimeout(resolve, 2)); return "processed"; }, async () => "finalized_terminal");
  const summary = await runBillingWebhookRetryWorker({ repository });
  assert.equal(repository.maxActive, 1);
  assert.deepEqual(repository.calls, ["subscription_created:created", "finalize:processed", "subscription_updated:updated", "finalize:processed"]);
  assert.deepEqual(summary, { claimed: 2, processed: 2, alreadyTerminal: 0, retried: 0, manualReview: 0, claimLost: 0 });
});

test("processor exception becomes transient_error and does not stop the next event", async () => {
  const repository = new MemoryRepository(events, async (event) => { if (event.webhookEventId === "created") throw new Error("private database detail"); return "processed"; }, async (outcome) => outcome === "transient_error" ? "retry_scheduled" : "finalized_terminal");
  const summary = await runBillingWebhookRetryWorker({ repository });
  assert.deepEqual(repository.calls, ["subscription_created:created", "finalize:transient_error", "subscription_updated:updated", "finalize:processed"]);
  assert.deepEqual(summary, { claimed: 2, processed: 1, alreadyTerminal: 0, retried: 1, manualReview: 0, claimLost: 0 });
});

test("known terminal, dependency, manual-review and claim-lost outcomes aggregate safely", async () => {
  const claimed: ClaimedBillingWebhookEvent[] = ["a", "b", "c", "d"].map((id) => ({ webhookEventId: id, eventName: "subscription_updated", claimToken: `token-${id}` }));
  const processorOutcomes = new Map([["a", "already_applied"], ["b", "dependency_pending"], ["c", "manual_review"], ["d", "stale_ignored"]]);
  const repository = new MemoryRepository(claimed, async (event) => processorOutcomes.get(event.webhookEventId)!, async (outcome) => outcome === "dependency_pending" ? "retry_scheduled" : outcome === "manual_review" ? "manual_review" : outcome === "stale_ignored" ? "claim_lost" : "finalized_terminal");
  assert.deepEqual(await runBillingWebhookRetryWorker({ repository }), { claimed: 4, processed: 0, alreadyTerminal: 1, retried: 1, manualReview: 1, claimLost: 1 });
});

test("unknown processor outcome is finalized as unknown_outcome", async () => {
  const repository = new MemoryRepository([events[0]], async () => "future_outcome", async (outcome) => { assert.equal(outcome, "unknown_outcome"); return "manual_review"; });
  assert.equal((await runBillingWebhookRetryWorker({ repository })).manualReview, 1);
});

test("finalizer exception is contained and later events continue", async () => {
  let calls = 0;
  const repository = new MemoryRepository(events, async () => "processed", async () => { calls += 1; if (calls === 1) throw new Error("private finalizer detail"); return "finalized_terminal"; });
  assert.deepEqual(await runBillingWebhookRetryWorker({ repository }), { claimed: 2, processed: 1, alreadyTerminal: 0, retried: 0, manualReview: 0, claimLost: 1 });
});

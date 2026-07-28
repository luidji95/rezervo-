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
      .from("billing_webhook_events")
      .insert({
        provider: input.provider,
        environment: input.environment,
        event_name: input.eventName,
        provider_object_type: input.providerObjectType,
        provider_object_id: input.providerObjectId,
        payload_hash: input.payloadHash,
        semantic_fingerprint: input.semanticFingerprint,
        processing_status: input.processingStatus,
        processed_at: input.processedAt,
      })
      .select("id")
      .single();

    if (error?.code === "23505") return { outcome: "duplicate" as const };
    if (error || !data) throw new Error("BILLING_WEBHOOK_STORAGE_FAILED");
    return { outcome: "inserted" as const, id: data.id };
  }
}

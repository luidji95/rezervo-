import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingEnvironment } from "../config/billingEnvironment";
import type { BillingCustomerPortalRepository, PortalSubscription } from "./billingCustomerPortalCore";

export class SupabaseBillingCustomerPortalRepository implements BillingCustomerPortalRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) { this.client = client; }

  async findOwnerSubscription(userId: string): Promise<PortalSubscription | "forbidden" | null> {
    const { data: salons, error: salonError } = await this.client.from("salons").select("id").eq("owner_id", userId).limit(2);
    if (salonError) throw new Error("BILLING_PORTAL_OWNER_LOOKUP_FAILED");
    if (!salons || salons.length !== 1) return salons?.length === 0 ? "forbidden" : null;

    const { data: subscriptions, error } = await this.client
      .from("subscriptions")
      .select("status,billing_provider,billing_environment,provider_subscription_id,provider_customer_id")
      .eq("salon_id", salons[0].id)
      .limit(2);
    if (error) throw new Error("BILLING_PORTAL_SUBSCRIPTION_LOOKUP_FAILED");
    if (!subscriptions || subscriptions.length !== 1) return null;
    const row = subscriptions[0];
    return {
      provider: row.billing_provider as "lemonsqueezy",
      environment: row.billing_environment as BillingEnvironment,
      providerSubscriptionId: row.provider_subscription_id ?? "",
      providerCustomerId: row.provider_customer_id ?? "",
      status: row.status,
    };
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseBillingCustomerPortalRepository } from "./supabaseBillingCustomerPortalRepositoryCore.ts";
import { openBillingCustomerPortal } from "./billingCustomerPortalCore.ts";

function repository(salons = [{ id: "salon-a", owner_id: "owner-a" }, { id: "salon-b", owner_id: "owner-b" }]) {
  const subscriptions = salons.map(s => ({ salon_id: s.id, status: "past_due", billing_provider: "lemonsqueezy", billing_environment: "live", provider_subscription_id: `subscription-${s.id}`, provider_customer_id: `customer-${s.id}` }));
  const client = { from(table: string) {
    let rows: Record<string, string>[] = table === "salons" ? salons : subscriptions;
    return {
      select() { return this; },
      eq(key: string, value: string) { rows = rows.filter(row => row[key] === value); return this; },
      async limit(count: number) { return { data: rows.slice(0, count), error: null }; },
    };
  } } as unknown as SupabaseClient;
  return new SupabaseBillingCustomerPortalRepository(client);
}

test("repository scopes the subscription to the authenticated owner's salon", async () => {
  const result = await repository().findOwnerSubscription("owner-b");
  assert.deepEqual(result, { provider: "lemonsqueezy", environment: "live", status: "past_due", providerSubscriptionId: "subscription-salon-b", providerCustomerId: "customer-salon-b" });
});

for (const userId of ["manager-a", "employee-a", "unrelated-user"]) test(`${userId} cannot fetch another tenant's portal`, async () => {
  let calls = 0;
  await assert.rejects(openBillingCustomerPortal({ userId, repository: repository(), environment: "live", databaseEnvironmentMatches: true, provider: { async createCustomerPortal() { calls++; return { url: "never" }; } } }), /BILLING_PORTAL_FORBIDDEN/);
  assert.equal(calls, 0);
});

test("ambiguous owner salons fail closed", async () => {
  assert.equal(await repository([{ id: "salon-a", owner_id: "owner" }, { id: "salon-b", owner_id: "owner" }]).findOwnerSubscription("owner"), null);
});

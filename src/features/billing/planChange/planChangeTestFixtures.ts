/** Test-only Lemon Squeezy subscription payloads (synthetic; contains decoy PII/URL fields). */
export function subscriptionPayload(overrides: Record<string, unknown> = {}, id = "2618348") {
  return {
    data: {
      type: "subscriptions", id,
      attributes: {
        store_id: 501229, customer_id: 8001, order_id: 9001, product_id: 1451030, variant_id: 2264918,
        status: "active", cancelled: false, pause: null, trial_ends_at: null,
        renews_at: "2027-03-31T00:00:00.000000Z", ends_at: null,
        created_at: "2027-02-28T00:00:00.000000Z", updated_at: "2027-02-28T00:00:30.000000Z",
        test_mode: true, payment_processor: "stripe",
        user_email: "private@example.invalid", urls: { customer_portal: "https://signed.example.invalid/x?signature=secret" },
        ...overrides,
      },
    },
  };
}

import type {
  BillingProvider,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
} from "./billingProvider.ts";
import { BillingCheckoutError } from "./billingCheckoutErrors.ts";

export type MockBillingProviderMode =
  | "success"
  | "rejected"
  | "timeout"
  | "unavailable";

export class MockBillingProvider implements BillingProvider {
  public calls: CreateCheckoutSessionInput[] = [];
  private readonly mode: MockBillingProviderMode;

  constructor(mode: MockBillingProviderMode = "success") {
    this.mode = mode;
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    this.calls.push(input);
    if (this.mode === "rejected") {
      throw new BillingCheckoutError("BILLING_PROVIDER_REJECTED", 502);
    }
    if (this.mode === "timeout") {
      throw new BillingCheckoutError(
        "BILLING_RECONCILIATION_REQUIRED",
        503,
      );
    }
    if (this.mode === "unavailable") {
      throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
    }
    return {
      provider: "lemonsqueezy",
      providerSessionId: `mock-${input.idempotencyKey}`,
      checkoutUrl: `https://sandbox.example.invalid/checkout/${input.idempotencyKey}`,
      expiresAt: input.expiresAt,
      environment: input.environment,
    };
  }
}

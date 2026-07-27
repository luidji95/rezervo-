import type {
  BillingProvider,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
} from "./billingProvider.ts";
import { BillingCheckoutError } from "./billingCheckoutErrors.ts";

const API_URL = "https://api.lemonsqueezy.com/v1/checkouts";
const JSON_API = "application/vnd.api+json";

type LemonSqueezyCheckoutResponse = {
  data?: {
    type?: unknown;
    id?: unknown;
    attributes?: {
      url?: unknown;
      expires_at?: unknown;
      test_mode?: unknown;
    };
  };
};

function positiveIntegerId(value: string) {
  if (!/^\d+$/.test(value)) {
    throw new BillingCheckoutError("BILLING_PRICE_MAPPING_MISSING", 503);
  }
  return value;
}

export class LemonSqueezyCheckoutCore implements BillingProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 10_000,
  ) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    if (input.environment !== "test") {
      throw new BillingCheckoutError("BILLING_NOT_CONFIGURED", 503);
    }

    const storeId = positiveIntegerId(input.providerStoreId);
    const variantId = positiveIntegerId(input.providerVariantId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(API_URL, {
        method: "POST",
        headers: {
          Accept: JSON_API,
          "Content-Type": JSON_API,
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: "checkouts",
            attributes: {
              product_options: {
                redirect_url: input.successUrl,
                enabled_variants: [Number(variantId)],
              },
              checkout_options: {
                skip_trial: true,
                subscription_preview: true,
              },
              checkout_data: {
                ...(input.customerEmail ? { email: input.customerEmail } : {}),
                custom: {
                  salon_id: input.salonId,
                  plan_code: input.planCode,
                  idempotency_key: input.idempotencyKey,
                },
              },
              expires_at: input.expiresAt,
              test_mode: true,
            },
            relationships: {
              store: { data: { type: "stores", id: storeId } },
              variant: { data: { type: "variants", id: variantId } },
            },
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          throw new BillingCheckoutError("BILLING_PROVIDER_REJECTED", 502);
        }
        throw new BillingCheckoutError(
          "BILLING_RECONCILIATION_REQUIRED",
          503,
        );
      }

      const payload = (await response.json()) as LemonSqueezyCheckoutResponse;
      const id = payload.data?.id;
      const checkoutUrl = payload.data?.attributes?.url;
      const providerExpiresAt = payload.data?.attributes?.expires_at;
      if (
        payload.data?.type !== "checkouts" ||
        typeof id !== "string" ||
        typeof checkoutUrl !== "string" ||
        payload.data.attributes?.test_mode !== true
      ) {
        throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
      }
      const parsedUrl = new URL(checkoutUrl);
      if (parsedUrl.protocol !== "https:") {
        throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
      }

      return {
        provider: "lemonsqueezy",
        providerSessionId: id,
        checkoutUrl,
        expiresAt:
          typeof providerExpiresAt === "string"
            ? providerExpiresAt
            : input.expiresAt,
        environment: "test",
      };
    } catch (error) {
      if (error instanceof BillingCheckoutError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BillingCheckoutError(
          "BILLING_RECONCILIATION_REQUIRED",
          503,
        );
      }
      throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
    } finally {
      clearTimeout(timeout);
    }
  }
}

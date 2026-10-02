import type {
  BillingProvider,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
} from "./billingProvider.ts";
import { BillingCheckoutError } from "./billingCheckoutErrors.ts";
import { expectedLemonSqueezyTestMode } from "../config/billingEnvironment.ts";
import {
  parseLemonSqueezyNumericObjectId,
} from "./lemonSqueezyResourceIds.ts";
import {
  LemonSqueezyCheckoutRetrievalError,
  parseLemonSqueezyCheckoutResponse,
} from "./lemonSqueezyCheckoutRetrievalCore.ts";
import {
  isLemonSqueezyJsonApiContentType,
  validateLemonSqueezyCheckoutAccess,
} from "./lemonSqueezyCheckoutValidation.ts";

const API_URL = "https://api.lemonsqueezy.com/v1/checkouts";
const JSON_API = "application/vnd.api+json";

const DEFINITIVE_REJECTION_STATUSES = new Set([400, 401, 403, 404, 422]);

export class LemonSqueezyCheckoutCore implements BillingProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 10_000,
    now: () => Date = () => new Date(),
  ) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const expectedTestMode = expectedLemonSqueezyTestMode(input.environment);
    let storeId: string;
    let variantId: string;
    try {
      storeId = parseLemonSqueezyNumericObjectId(input.providerStoreId);
      variantId = parseLemonSqueezyNumericObjectId(input.providerVariantId);
    } catch {
      throw new BillingCheckoutError("BILLING_PRICE_MAPPING_MISSING", 503);
    }
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
                  checkout_session_id: input.checkoutSessionId,
                  salon_id: input.salonId,
                  plan_code: input.planCode,
                  idempotency_key: input.idempotencyKey,
                },
              },
              expires_at: input.expiresAt,
              test_mode: expectedTestMode,
            },
            relationships: {
              store: { data: { type: "stores", id: storeId } },
              variant: { data: { type: "variants", id: variantId } },
            },
          },
        }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });

      if (response.status !== 201) {
        if (DEFINITIVE_REJECTION_STATUSES.has(response.status)) {
          throw new BillingCheckoutError("BILLING_PROVIDER_REJECTED", 502);
        }
        throw new BillingCheckoutError(
          "BILLING_RECONCILIATION_REQUIRED",
          503,
        );
      }
      if (!isLemonSqueezyJsonApiContentType(response.headers.get("content-type"))) {
        throw new BillingCheckoutError(
          "BILLING_RECONCILIATION_REQUIRED",
          503,
        );
      }
      let payload: unknown;
      try { payload = await response.json() as unknown; }
      catch {
        throw new BillingCheckoutError(
          "BILLING_RECONCILIATION_REQUIRED",
          503,
        );
      }
      const checkout = parseLemonSqueezyCheckoutResponse(payload);
      if (
        checkout.testMode !== expectedTestMode ||
        checkout.storeId !== storeId ||
        checkout.variantId !== variantId ||
        checkout.customCheckoutSessionId !== input.checkoutSessionId ||
        checkout.customIdempotencyKey !== input.idempotencyKey ||
        checkout.customSalonId !== input.salonId ||
        checkout.customPlanCode !== input.planCode
      ) {
        throw new BillingCheckoutError(
          "BILLING_RECONCILIATION_REQUIRED",
          503,
        );
      }
      const validated = validateLemonSqueezyCheckoutAccess({
        providerCheckoutId: checkout.providerCheckoutId,
        checkoutUrl: checkout.checkoutUrl,
        providerExpiresAt: checkout.expiresAt,
        now: this.now(),
      });
      if (!validated) {
        throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
      }

      return {
        provider: "lemonsqueezy",
        providerSessionId: checkout.providerCheckoutId,
        checkoutUrl: checkout.checkoutUrl,
        expiresAt: validated.providerExpiresAt,
        environment: input.environment,
      };
    } catch (error) {
      if (error instanceof BillingCheckoutError) throw error;
      if (error instanceof LemonSqueezyCheckoutRetrievalError) {
        throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
      }
      throw new BillingCheckoutError(
        "BILLING_RECONCILIATION_REQUIRED",
        503,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

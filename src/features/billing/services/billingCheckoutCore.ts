import { createHash } from "node:crypto";

import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type {
  BillingProvider,
  CheckoutPlanCode,
  CreateCheckoutSessionResult,
} from "../providers/billingProvider.ts";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";
import { expectedLemonSqueezyTestMode } from "../config/billingEnvironment.ts";
import {
  LemonSqueezyCheckoutRetrievalError,
  type LemonSqueezyRetrievedCheckout,
} from "../providers/lemonSqueezyCheckoutRetrievalCore.ts";
import { validateCheckoutForRecoveryFinalization } from "../checkoutRecovery/billingCheckoutRecoveryCore.ts";

export type BillingPriceMapping = {
  id: string;
  planId: string;
  planCode: CheckoutPlanCode;
  planActive: boolean;
  planMonthlyPrice: number;
  planCurrency: string;
  mappingActive: boolean;
  mappingAmount: number;
  mappingCurrency: string;
  providerVariantId: string;
  providerStoreId: string;
  environment: BillingEnvironment;
};

export type BillingCheckoutLedger = {
  id: string;
  salonId: string;
  actorProfileId: string;
  requestedPlanId: string;
  idempotencyKey: string;
  status: "creating" | "open" | "completed" | "expired" | "failed" | "cancelled";
  expiresAt: string | null;
};

export type InsertCreatingResult =
  | {
      outcome: "created";
      checkoutSession: BillingCheckoutLedger & { status: "creating" };
    }
  | {
      outcome: "existing";
      checkoutSession: BillingCheckoutLedger;
    };

export type BillingCheckoutIntentAcquisition = {
  outcome: "created" | "existing";
  checkoutSession: BillingCheckoutLedger;
  provider: "lemonsqueezy";
  environment: BillingEnvironment;
  providerSessionId: string | null;
};

export type BillingCheckoutCurrentState = BillingCheckoutLedger & {
  provider: "lemonsqueezy";
  environment: BillingEnvironment;
  providerSessionId: string | null;
  checkoutUrlHash: string | null;
};

export type BillingCheckoutRetrievalProvider = {
  retrieveById(providerCheckoutId: string): Promise<LemonSqueezyRetrievedCheckout>;
};

export interface BillingCheckoutRepository {
  isSalonOwner(salonId: string, actorProfileId: string): Promise<boolean>;
  hasActiveOverride(salonId: string, now: string): Promise<boolean>;
  getPriceMapping(planCode: CheckoutPlanCode): Promise<BillingPriceMapping | null>;
  acquireCheckoutIntent(input: {
    salonId: string;
    actorProfileId: string;
    planId: string;
  }): Promise<BillingCheckoutIntentAcquisition>;
  getCheckoutSessionById(id: string): Promise<BillingCheckoutCurrentState | null>;
  findByIdempotencyKey(key: string): Promise<BillingCheckoutLedger | null>;
  findReusableOpenSession(input: {
    salonId: string;
    planId: string;
    now: string;
  }): Promise<BillingCheckoutLedger | null>;
  markExpired(id: string): Promise<void>;
  insertCreating(input: {
    salonId: string;
    actorProfileId: string;
    planId: string;
    idempotencyKey: string;
  }): Promise<InsertCreatingResult>;
  markOpen(input: {
    id: string;
    providerSessionId: string;
    checkoutUrlHash: string;
    expiresAt: string;
  }): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
}

export type CreateBillingCheckoutInput = {
  salonId: string;
  actorProfileId: string;
  actorEmail?: string;
  planCode: CheckoutPlanCode;
  idempotencyKey?: string;
};

export type BillingCheckoutRuntime = {
  appUrl: string;
  storeId: string;
  environment: BillingEnvironment;
  liveAllowedSalonIds: ReadonlySet<string> | null;
  now: () => Date;
};

function retrievalFailure(error: unknown): never {
  if (error instanceof LemonSqueezyCheckoutRetrievalError) {
    if (error.kind === "provider_unavailable" || error.kind === "configuration_error") {
      throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
    }
    throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
  }
  throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
}

async function resumeExistingOpenCheckout(input: {
  request: CreateBillingCheckoutInput;
  ledger: BillingCheckoutLedger;
  providerSessionId: string | null;
  mapping: BillingPriceMapping;
  repository: BillingCheckoutRepository;
  retrievalProvider: BillingCheckoutRetrievalProvider;
  runtime: BillingCheckoutRuntime;
}) {
  if (!input.providerSessionId) {
    throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
  }
  let checkout: LemonSqueezyRetrievedCheckout;
  try {
    checkout = await input.retrievalProvider.retrieveById(input.providerSessionId);
  } catch (error) {
    retrievalFailure(error);
  }
  if (
    checkout.providerCheckoutId !== input.providerSessionId ||
    checkout.testMode !== expectedLemonSqueezyTestMode(input.runtime.environment)
  ) {
    throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
  }
  const validated = validateCheckoutForRecoveryFinalization({
    checkout,
    ledger: {
      ledgerId: input.ledger.id,
      environment: input.runtime.environment,
      expectedStoreId: input.runtime.storeId,
      expectedVariantId: input.mapping.providerVariantId,
      localCreatedAt: input.runtime.now().toISOString(),
      localExpiresAt: input.ledger.expiresAt,
      expectedSalonId: input.request.salonId,
      expectedPlanCode: input.request.planCode,
      expectedIdempotencyKey: input.ledger.idempotencyKey,
      knownProviderCheckoutIds: new Set(),
    },
    now: input.runtime.now(),
  });
  if (!validated) {
    throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
  }

  let current: BillingCheckoutCurrentState | null;
  try {
    current = await input.repository.getCheckoutSessionById(input.ledger.id);
  } catch {
    throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
  }
  if (
    !current ||
    current.id !== input.ledger.id ||
    current.salonId !== input.request.salonId ||
    current.actorProfileId !== input.ledger.actorProfileId ||
    current.requestedPlanId !== input.mapping.planId ||
    current.provider !== "lemonsqueezy" ||
    current.environment !== input.runtime.environment ||
    current.status !== "open" ||
    current.providerSessionId !== input.providerSessionId ||
    current.idempotencyKey !== input.ledger.idempotencyKey ||
    current.checkoutUrlHash !== validated.checkoutUrlHash ||
    current.expiresAt !== validated.providerExpiresAt ||
    Date.parse(current.expiresAt) <= input.runtime.now().getTime()
  ) {
    throw new BillingCheckoutError("BILLING_RECONCILIATION_REQUIRED", 503);
  }
  return {
    provider: "lemonsqueezy" as const,
    environment: input.runtime.environment,
    checkoutUrl: checkout.checkoutUrl,
    expiresAt: checkout.expiresAt!,
    responseStatus: 200 as const,
  };
}

export async function createBillingCheckout(
  input: CreateBillingCheckoutInput,
  repository: BillingCheckoutRepository,
  provider: BillingProvider,
  runtime: BillingCheckoutRuntime,
  retrievalProvider?: BillingCheckoutRetrievalProvider,
) {
  if (
    runtime.environment === "live" &&
    !runtime.liveAllowedSalonIds?.has(input.salonId)
  ) {
    throw new BillingCheckoutError("BILLING_CHECKOUT_DISABLED", 404);
  }
  if (!(await repository.isSalonOwner(input.salonId, input.actorProfileId))) {
    throw new BillingCheckoutError("BILLING_OWNER_REQUIRED", 403);
  }
  const now = runtime.now();
  const nowIso = now.toISOString();
  if (await repository.hasActiveOverride(input.salonId, nowIso)) {
    throw new BillingCheckoutError("BILLING_OVERRIDE_ACTIVE", 409);
  }

  const mapping = await repository.getPriceMapping(input.planCode);
  if (!mapping) {
    throw new BillingCheckoutError("BILLING_PRICE_MAPPING_MISSING", 503);
  }
  if (!mapping.planActive || !mapping.mappingActive) {
    throw new BillingCheckoutError("BILLING_PLAN_NOT_AVAILABLE", 409);
  }
  if (
    mapping.planCode !== input.planCode ||
    mapping.environment !== runtime.environment ||
    !mapping.providerStoreId.trim() ||
    mapping.providerStoreId !== runtime.storeId ||
    mapping.planCurrency !== "RSD" ||
    mapping.mappingCurrency !== mapping.planCurrency ||
    mapping.mappingAmount !== mapping.planMonthlyPrice
  ) {
    throw new BillingCheckoutError("BILLING_PRICE_MISMATCH", 409);
  }

  const acquisition = await repository.acquireCheckoutIntent({
    salonId: input.salonId,
    actorProfileId: input.actorProfileId,
    planId: mapping.planId,
  });
  const ledger = acquisition.checkoutSession;
  if (
    acquisition.provider !== "lemonsqueezy" ||
    acquisition.environment !== runtime.environment ||
    ledger.salonId !== input.salonId
  ) {
    throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
  }
  if (acquisition.outcome === "existing") {
    if (ledger.requestedPlanId !== mapping.planId) {
      throw new BillingCheckoutError("BILLING_CHECKOUT_IN_PROGRESS", 409);
    }
    if (ledger.status !== "creating" && ledger.status !== "open") {
      throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
    }
    if (ledger.status === "open") {
      if (!retrievalProvider) {
        throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
      }
      return resumeExistingOpenCheckout({
        request: input,
        ledger,
        providerSessionId: acquisition.providerSessionId,
        mapping,
        repository,
        retrievalProvider,
        runtime,
      });
    }
    throw new BillingCheckoutError("BILLING_CHECKOUT_PENDING", 202);
  }
  if (
    ledger.status !== "creating" ||
    ledger.requestedPlanId !== mapping.planId ||
    ledger.actorProfileId !== input.actorProfileId ||
    acquisition.providerSessionId !== null
  ) {
    throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
  }

  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  let result: CreateCheckoutSessionResult;
  try {
    result = await provider.createCheckoutSession({
      checkoutSessionId: ledger.id,
      salonId: input.salonId,
      actorProfileId: input.actorProfileId,
      planCode: input.planCode,
      billingInterval: "monthly",
      idempotencyKey: ledger.idempotencyKey,
      successUrl: `${runtime.appUrl}/settings?tab=billing&checkout=return`,
      cancelUrl: `${runtime.appUrl}/settings?tab=billing&checkout=cancelled`,
      customerEmail: input.actorEmail,
      environment: runtime.environment,
      providerStoreId: runtime.storeId,
      providerVariantId: mapping.providerVariantId,
      expiresAt,
    });
  } catch (error) {
    if (
      error instanceof BillingCheckoutError &&
      error.code === "BILLING_RECONCILIATION_REQUIRED"
    ) {
      throw error;
    }
    if (!(error instanceof BillingCheckoutError)) {
      throw new BillingCheckoutError(
        "BILLING_RECONCILIATION_REQUIRED",
        503,
      );
    }
    await repository.markFailed(ledger.id, error.code);
    throw error;
  }

  try {
    await repository.markOpen({
      id: ledger.id,
      providerSessionId: result.providerSessionId,
      checkoutUrlHash: createHash("sha256").update(result.checkoutUrl).digest("hex"),
      expiresAt: result.expiresAt,
    });
  } catch {
    throw new BillingCheckoutError(
      "BILLING_RECONCILIATION_REQUIRED",
      503,
    );
  }

  return {
    provider: result.provider,
    environment: result.environment,
    checkoutUrl: result.checkoutUrl,
    expiresAt: result.expiresAt,
    responseStatus: 201 as const,
  };
}

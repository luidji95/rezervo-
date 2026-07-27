import { createHash, randomUUID } from "node:crypto";

import type { BillingProvider, CheckoutPlanCode } from "../providers/billingProvider.ts";
import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";

export type BillingPriceMapping = {
  id: string;
  planId: string;
  planCode: string;
  planActive: boolean;
  planMonthlyPrice: number;
  planCurrency: string;
  mappingActive: boolean;
  mappingAmount: number;
  mappingCurrency: string;
  providerVariantId: string;
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

export interface BillingCheckoutRepository {
  isSalonOwner(salonId: string, actorProfileId: string): Promise<boolean>;
  hasActiveOverride(salonId: string, now: string): Promise<boolean>;
  getPriceMapping(planCode: CheckoutPlanCode): Promise<BillingPriceMapping | null>;
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
  }): Promise<BillingCheckoutLedger>;
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
  now: () => Date;
};

function assertExistingAttemptMatches(
  existing: BillingCheckoutLedger,
  input: CreateBillingCheckoutInput,
  planId: string,
) {
  if (
    existing.salonId !== input.salonId ||
    existing.actorProfileId !== input.actorProfileId ||
    existing.requestedPlanId !== planId
  ) {
    throw new BillingCheckoutError("INVALID_INPUT", 400);
  }
  throw new BillingCheckoutError("BILLING_CHECKOUT_IN_PROGRESS", 409);
}

export async function createBillingCheckout(
  input: CreateBillingCheckoutInput,
  repository: BillingCheckoutRepository,
  provider: BillingProvider,
  runtime: BillingCheckoutRuntime,
) {
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
    mapping.planCurrency !== "RSD" ||
    mapping.mappingCurrency !== mapping.planCurrency ||
    mapping.mappingAmount !== mapping.planMonthlyPrice
  ) {
    throw new BillingCheckoutError("BILLING_PRICE_MISMATCH", 409);
  }

  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const existing = await repository.findByIdempotencyKey(idempotencyKey);
  if (existing) assertExistingAttemptMatches(existing, input, mapping.planId);

  const reusable = await repository.findReusableOpenSession({
    salonId: input.salonId,
    planId: mapping.planId,
    now: nowIso,
  });
  if (reusable) {
    if (reusable.expiresAt && Date.parse(reusable.expiresAt) <= now.getTime()) {
      await repository.markExpired(reusable.id);
    } else {
      throw new BillingCheckoutError("BILLING_CHECKOUT_IN_PROGRESS", 409);
    }
  }

  let ledger: BillingCheckoutLedger;
  try {
    ledger = await repository.insertCreating({
      salonId: input.salonId,
      actorProfileId: input.actorProfileId,
      planId: mapping.planId,
      idempotencyKey,
    });
  } catch {
    const raced = await repository.findByIdempotencyKey(idempotencyKey);
    if (raced) assertExistingAttemptMatches(raced, input, mapping.planId);
    throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
  }

  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  try {
    const result = await provider.createCheckoutSession({
      salonId: input.salonId,
      actorProfileId: input.actorProfileId,
      planCode: input.planCode,
      billingInterval: "monthly",
      idempotencyKey,
      successUrl: `${runtime.appUrl}/settings?tab=billing&checkout=return`,
      cancelUrl: `${runtime.appUrl}/settings?tab=billing&checkout=cancelled`,
      customerEmail: input.actorEmail,
      environment: "test",
      providerStoreId: runtime.storeId,
      providerVariantId: mapping.providerVariantId,
      expiresAt,
    });
    await repository.markOpen({
      id: ledger.id,
      providerSessionId: result.providerSessionId,
      checkoutUrlHash: createHash("sha256").update(result.checkoutUrl).digest("hex"),
      expiresAt: result.expiresAt,
    });
    return {
      provider: result.provider,
      environment: result.environment,
      checkoutUrl: result.checkoutUrl,
      expiresAt: result.expiresAt,
    };
  } catch (error) {
    if (
      error instanceof BillingCheckoutError &&
      error.code === "BILLING_RECONCILIATION_REQUIRED"
    ) {
      throw error;
    }
    const safeCode =
      error instanceof BillingCheckoutError
        ? error.code
        : "BILLING_PROVIDER_UNAVAILABLE";
    await repository.markFailed(ledger.id, safeCode);
    if (error instanceof BillingCheckoutError) throw error;
    throw new BillingCheckoutError("BILLING_PROVIDER_UNAVAILABLE", 503);
  }
}

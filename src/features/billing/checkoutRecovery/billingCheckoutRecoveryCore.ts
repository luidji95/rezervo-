import { createHash } from "node:crypto";

import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import { parseLemonSqueezyCheckoutId } from "../providers/lemonSqueezyResourceIds.ts";
import {
  LemonSqueezyCheckoutRetrievalError,
  buildLemonSqueezyCheckoutListRequest,
  correlateLemonSqueezyCheckoutCandidates,
  searchLemonSqueezyCheckoutPages,
  type CheckoutRecoveryLedgerFacts,
  type LemonSqueezyCheckoutPage,
  type LemonSqueezyRetrievedCheckout,
} from "../providers/lemonSqueezyCheckoutRetrievalCore.ts";
import type {
  BillingCheckoutRecoveryRepository,
  CheckoutRecoveryAuditOutcome,
} from "./billingCheckoutRecoveryRepository.ts";

export type BillingCheckoutRecoveryOutcome =
  | "already_open"
  | "already_completed"
  | "already_claimed"
  | "manual_review"
  | "recovered_open"
  | "already_recovered_open"
  | "finalization_conflict"
  | "attempt_state_conflict"
  | "provider_id_conflict"
  | "provider_checkout_expired"
  | "ledger_state_conflict"
  | CheckoutRecoveryAuditOutcome
  | "claim_lost";

export type CheckoutRecoveryProviderGateway = {
  retrieveById(providerCheckoutId: string): Promise<LemonSqueezyRetrievedCheckout>;
  fetchListPage(url: string, expected: { storeId: string; variantId: string }): Promise<LemonSqueezyCheckoutPage>;
  buildFirstListPageUrl(input: { storeId: string; variantId: string; pageSize: number }): string;
};

function providerErrorOutcome(error: unknown): CheckoutRecoveryAuditOutcome {
  if (!(error instanceof LemonSqueezyCheckoutRetrievalError)) throw error;
  if (error.kind === "provider_not_found") return "provider_not_found";
  if (error.kind === "provider_unavailable") return "provider_unavailable";
  if (error.kind === "configuration_error") return "configuration_error";
  return "invalid_provider_response";
}

export function validateCheckoutForRecoveryFinalization(input: {
  checkout: LemonSqueezyRetrievedCheckout;
  ledger: CheckoutRecoveryLedgerFacts;
  now: Date;
}): { checkoutUrlHash: string; providerExpiresAt: string } | null {
  const { checkout, ledger, now } = input;
  let checkoutId: string;
  try { checkoutId = parseLemonSqueezyCheckoutId(checkout.providerCheckoutId); }
  catch { return null; }
  if (
    checkout.customCheckoutSessionId !== ledger.ledgerId ||
    checkout.customSalonId !== ledger.expectedSalonId ||
    checkout.customPlanCode !== ledger.expectedPlanCode ||
    checkout.customIdempotencyKey !== ledger.expectedIdempotencyKey ||
    checkout.storeId !== ledger.expectedStoreId ||
    checkout.variantId !== ledger.expectedVariantId ||
    checkout.expiresAt === null
  ) return null;

  const nowMs = now.getTime();
  const providerExpiryMs = Date.parse(checkout.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(providerExpiryMs) || providerExpiryMs <= nowMs) return null;

  let url: URL;
  try { url = new URL(checkout.checkoutUrl); }
  catch { return null; }
  const keys = [...url.searchParams.keys()];
  if (
    url.protocol !== "https:" || url.hostname !== "rezervoo.lemonsqueezy.com" ||
    url.port || url.username || url.password || url.hash ||
    url.pathname !== `/checkout/custom/${checkoutId}` ||
    keys.length !== 2 || keys.some((key) => key !== "expires" && key !== "signature") ||
    url.searchParams.getAll("expires").length !== 1 ||
    url.searchParams.getAll("signature").length !== 1
  ) return null;
  const expires = url.searchParams.get("expires");
  const signature = url.searchParams.get("signature");
  if (!expires || !/^[1-9]\d{0,9}$/.test(expires) || !signature?.trim()) return null;
  const expiresSeconds = Number(expires);
  if (!Number.isSafeInteger(expiresSeconds)) return null;
  const urlExpiryMs = expiresSeconds * 1000;
  if (!Number.isSafeInteger(urlExpiryMs) || !Number.isFinite(new Date(urlExpiryMs).getTime()) || urlExpiryMs <= nowMs) return null;

  return {
    checkoutUrlHash: createHash("sha256").update(checkout.checkoutUrl).digest("hex"),
    providerExpiresAt: checkout.expiresAt,
  };
}

async function finalizeExactMatch(input: {
  checkout: LemonSqueezyRetrievedCheckout;
  checkoutUrlHash: string;
  providerExpiresAt: string;
  recoveryAttemptId: string;
  claimToken: string;
  environment: BillingEnvironment;
  repository: BillingCheckoutRecoveryRepository;
}): Promise<BillingCheckoutRecoveryOutcome> {
  const result = await input.repository.finalizeCheckoutRecovery({
    recoveryAttemptId: input.recoveryAttemptId,
    claimToken: input.claimToken,
    environment: input.environment,
    providerCheckoutId: input.checkout.providerCheckoutId,
    checkoutUrlHash: input.checkoutUrlHash,
    providerExpiresAt: input.providerExpiresAt,
  });
  switch (result.finalizationOutcome) {
    case "finalized": return "recovered_open";
    case "already_finalized": return "already_recovered_open";
    case "finalization_conflict": case "attempt_state_conflict":
    case "provider_id_conflict": case "provider_checkout_expired":
    case "ledger_state_conflict": case "claim_lost":
      return result.finalizationOutcome;
  }
}

export async function runBillingCheckoutRecovery(input: {
  checkoutSessionId: string;
  environment: BillingEnvironment;
  leaseSeconds: number;
  pageSize: number;
  maxPages: number;
  providerStoreId: string;
  now: () => Date;
  repository: BillingCheckoutRecoveryRepository;
  provider: CheckoutRecoveryProviderGateway;
}): Promise<BillingCheckoutRecoveryOutcome> {
  const claim = await input.repository.claimCheckoutRecovery({
    checkoutSessionId: input.checkoutSessionId,
    environment: input.environment,
    leaseSeconds: input.leaseSeconds,
  });
  if (claim.claimOutcome !== "claimed") return claim.claimOutcome;
  if (
    !claim.recoveryAttemptId || !claim.claimToken || claim.ledgerStatus !== "creating" ||
    claim.environment !== input.environment || claim.provider !== "lemonsqueezy" ||
    claim.checkoutSessionId !== input.checkoutSessionId
  ) {
    return "claim_lost";
  }

  let outcome: CheckoutRecoveryAuditOutcome;
  try {
    const mapping = await input.repository.resolveTrustedProviderMapping({
      requestedPlanId: claim.requestedPlanId,
      environment: input.environment,
    });
    if (!mapping || mapping.storeId !== input.providerStoreId) {
      outcome = "configuration_error";
    } else {
      const knownProviderCheckoutIds = await input.repository.listKnownProviderCheckoutIds({
        checkoutSessionId: claim.checkoutSessionId,
        environment: input.environment,
      });
      const ledger: CheckoutRecoveryLedgerFacts = {
        ledgerId: claim.checkoutSessionId,
        environment: input.environment,
        expectedStoreId: mapping.storeId,
        expectedVariantId: mapping.variantId,
        localCreatedAt: claim.ledgerCreatedAt,
        localExpiresAt: claim.ledgerExpiresAt,
        expectedSalonId: claim.salonId,
        expectedPlanCode: mapping.planCode,
        expectedIdempotencyKey: claim.idempotencyKey,
        knownProviderCheckoutIds,
      };

      if (claim.providerSessionId) {
        const checkout = await input.provider.retrieveById(claim.providerSessionId);
        if (checkout.providerCheckoutId !== claim.providerSessionId) {
          outcome = "invalid_candidate";
        } else {
          const correlation = correlateLemonSqueezyCheckoutCandidates(ledger, [checkout]);
          if (correlation.outcome === "exact_match") {
            const validated = validateCheckoutForRecoveryFinalization({ checkout: correlation.checkout, ledger, now: input.now() });
            if (validated) return finalizeExactMatch({ checkout: correlation.checkout, ...validated, recoveryAttemptId: claim.recoveryAttemptId, claimToken: claim.claimToken, environment: input.environment, repository: input.repository });
            outcome = "invalid_candidate";
          } else {
            outcome = correlation.outcome === "not_found"
                ? "invalid_candidate"
                : correlation.outcome;
          }
        }
      } else {
        const firstPageUrl = input.provider.buildFirstListPageUrl({
          storeId: mapping.storeId,
          variantId: mapping.variantId,
          pageSize: input.pageSize,
        });
        const search = await searchLemonSqueezyCheckoutPages({
          ledger,
          firstPageUrl,
          maxPages: input.maxPages,
          fetchPage: (url) => input.provider.fetchListPage(url, {
            storeId: mapping.storeId,
            variantId: mapping.variantId,
          }),
        });
        if (search.outcome === "exact_match") {
          const validated = validateCheckoutForRecoveryFinalization({ checkout: search.checkout, ledger, now: input.now() });
          if (validated) return finalizeExactMatch({ checkout: search.checkout, ...validated, recoveryAttemptId: claim.recoveryAttemptId, claimToken: claim.claimToken, environment: input.environment, repository: input.repository });
          outcome = "invalid_candidate";
        } else {
          outcome = search.outcome === "search_exhausted_not_found"
              ? "provider_not_found"
              : search.outcome;
        }
      }
    }
  } catch (error) {
    outcome = providerErrorOutcome(error);
  }

  const completion = await input.repository.completeCheckoutRecoveryAttempt({
    recoveryAttemptId: claim.recoveryAttemptId,
    claimToken: claim.claimToken,
    environment: input.environment,
    outcome,
  });
  if (completion.completionOutcome === "claim_lost") return "claim_lost";
  if (
    completion.completionOutcome !== "completed" &&
    completion.completionOutcome !== "already_completed"
  ) {
    throw new Error("BILLING_CHECKOUT_RECOVERY_COMPLETE_FAILED");
  }
  if (completion.outcome !== outcome) {
    throw new Error("BILLING_CHECKOUT_RECOVERY_COMPLETE_CONFLICT");
  }
  return outcome;
}

export function createLemonSqueezyRecoveryGateway(input: {
  client: {
    retrieveById(id: string): Promise<LemonSqueezyRetrievedCheckout>;
    listPageByUrl(url: string, expected: { storeId: string; variantId: string }): Promise<LemonSqueezyCheckoutPage>;
  };
  providerConfig: { provider: "lemonsqueezy"; environment: BillingEnvironment; apiKey: string; storeId: string };
}): CheckoutRecoveryProviderGateway {
  return {
    retrieveById: (id) => input.client.retrieveById(id),
    fetchListPage: (url, expected) => input.client.listPageByUrl(url, expected),
    buildFirstListPageUrl: ({ storeId, variantId, pageSize }) =>
      buildLemonSqueezyCheckoutListRequest({ storeId, variantId, pageNumber: 1, pageSize }, input.providerConfig).url,
  };
}

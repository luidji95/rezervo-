import type { BillingEnvironment } from "../config/billingEnvironment.ts";
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

export async function runBillingCheckoutRecovery(input: {
  checkoutSessionId: string;
  environment: BillingEnvironment;
  leaseSeconds: number;
  pageSize: number;
  maxPages: number;
  providerStoreId: string;
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
        const correlation = correlateLemonSqueezyCheckoutCandidates(ledger, [checkout]);
        outcome = correlation.outcome === "exact_match"
          ? "still_pending"
          : correlation.outcome === "not_found"
            ? "invalid_candidate"
            : correlation.outcome;
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
        outcome = search.outcome === "exact_match"
          ? "still_pending"
          : search.outcome === "search_exhausted_not_found"
            ? "provider_not_found"
            : search.outcome;
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

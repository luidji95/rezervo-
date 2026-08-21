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
import { validateLemonSqueezyCheckoutAccess } from "../providers/lemonSqueezyCheckoutValidation.ts";

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

export type CheckoutDirectRecoveryProviderGateway = Pick<
  CheckoutRecoveryProviderGateway,
  "retrieveById"
>;

export type BillingCheckoutDirectRecoveryResult =
  | {
      outcome: Exclude<
        BillingCheckoutRecoveryOutcome,
        "recovered_open" | "already_recovered_open"
      >;
    }
  | {
      outcome: "recovered_open" | "already_recovered_open";
      checkout: LemonSqueezyRetrievedCheckout;
      checkoutUrlHash: string;
      providerExpiresAt: string;
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
  try { parseLemonSqueezyCheckoutId(checkout.providerCheckoutId); }
  catch { return null; }
  if (
    checkout.customCheckoutSessionId !== ledger.ledgerId ||
    checkout.customSalonId !== ledger.expectedSalonId ||
    checkout.customPlanCode !== ledger.expectedPlanCode ||
    checkout.customIdempotencyKey !== ledger.expectedIdempotencyKey ||
    checkout.storeId !== ledger.expectedStoreId ||
    checkout.variantId !== ledger.expectedVariantId
  ) return null;
  return validateLemonSqueezyCheckoutAccess({
    providerCheckoutId: checkout.providerCheckoutId,
    checkoutUrl: checkout.checkoutUrl,
    providerExpiresAt: checkout.expiresAt,
    now,
  });
}

async function finalizeExactMatch(input: {
  checkout: LemonSqueezyRetrievedCheckout;
  checkoutUrlHash: string;
  providerExpiresAt: string;
  recoveryAttemptId: string;
  claimToken: string;
  environment: BillingEnvironment;
  repository: BillingCheckoutRecoveryRepository;
}): Promise<BillingCheckoutDirectRecoveryResult> {
  const result = await input.repository.finalizeCheckoutRecovery({
    recoveryAttemptId: input.recoveryAttemptId,
    claimToken: input.claimToken,
    environment: input.environment,
    providerCheckoutId: input.checkout.providerCheckoutId,
    checkoutUrlHash: input.checkoutUrlHash,
    providerExpiresAt: input.providerExpiresAt,
  });
  switch (result.finalizationOutcome) {
    case "finalized":
      return {
        outcome: "recovered_open",
        checkout: input.checkout,
        checkoutUrlHash: input.checkoutUrlHash,
        providerExpiresAt: input.providerExpiresAt,
      };
    case "already_finalized":
      return {
        outcome: "already_recovered_open",
        checkout: input.checkout,
        checkoutUrlHash: input.checkoutUrlHash,
        providerExpiresAt: input.providerExpiresAt,
      };
    case "finalization_conflict": case "attempt_state_conflict":
    case "provider_id_conflict": case "provider_checkout_expired":
    case "ledger_state_conflict": case "claim_lost":
      return { outcome: result.finalizationOutcome };
  }
}

async function completeRecoveryOutcome(input: {
  outcome: CheckoutRecoveryAuditOutcome;
  recoveryAttemptId: string;
  claimToken: string;
  environment: BillingEnvironment;
  repository: BillingCheckoutRecoveryRepository;
}): Promise<BillingCheckoutDirectRecoveryResult> {
  const completion = await input.repository.completeCheckoutRecoveryAttempt({
    recoveryAttemptId: input.recoveryAttemptId,
    claimToken: input.claimToken,
    environment: input.environment,
    outcome: input.outcome,
  });
  if (completion.completionOutcome === "claim_lost") {
    return { outcome: "claim_lost" };
  }
  if (
    completion.completionOutcome !== "completed" &&
    completion.completionOutcome !== "already_completed"
  ) {
    throw new Error("BILLING_CHECKOUT_RECOVERY_COMPLETE_FAILED");
  }
  if (completion.outcome !== input.outcome) {
    throw new Error("BILLING_CHECKOUT_RECOVERY_COMPLETE_CONFLICT");
  }
  return { outcome: input.outcome };
}

async function runClaimedDirectRecovery(input: {
  claim: Awaited<ReturnType<BillingCheckoutRecoveryRepository["claimCheckoutRecovery"]>>;
  checkoutSessionId: string;
  environment: BillingEnvironment;
  providerStoreId: string;
  now: () => Date;
  repository: BillingCheckoutRecoveryRepository;
  provider: CheckoutDirectRecoveryProviderGateway;
}): Promise<BillingCheckoutDirectRecoveryResult> {
  const { claim } = input;
  if (
    !claim.recoveryAttemptId || !claim.claimToken ||
    claim.ledgerStatus !== "creating" ||
    claim.environment !== input.environment ||
    claim.provider !== "lemonsqueezy" ||
    claim.checkoutSessionId !== input.checkoutSessionId
  ) {
    return { outcome: "claim_lost" };
  }

  let outcome: CheckoutRecoveryAuditOutcome;
  try {
    const mapping = await input.repository.resolveTrustedProviderMapping({
      requestedPlanId: claim.requestedPlanId,
      environment: input.environment,
    });
    if (!mapping || mapping.storeId !== input.providerStoreId) {
      outcome = "configuration_error";
    } else if (!claim.providerSessionId) {
      outcome = "still_pending";
    } else {
      const knownProviderCheckoutIds =
        await input.repository.listKnownProviderCheckoutIds({
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
      const checkout = await input.provider.retrieveById(
        claim.providerSessionId,
      );
      if (checkout.providerCheckoutId !== claim.providerSessionId) {
        outcome = "invalid_candidate";
      } else {
        const correlation = correlateLemonSqueezyCheckoutCandidates(
          ledger,
          [checkout],
        );
        if (correlation.outcome === "exact_match") {
          const validated = validateCheckoutForRecoveryFinalization({
            checkout: correlation.checkout,
            ledger,
            now: input.now(),
          });
          if (validated) {
            return finalizeExactMatch({
              checkout: correlation.checkout,
              ...validated,
              recoveryAttemptId: claim.recoveryAttemptId,
              claimToken: claim.claimToken,
              environment: input.environment,
              repository: input.repository,
            });
          }
          outcome = "invalid_candidate";
        } else {
          outcome =
            correlation.outcome === "not_found"
              ? "invalid_candidate"
              : correlation.outcome;
        }
      }
    }
  } catch (error) {
    outcome = providerErrorOutcome(error);
  }

  return completeRecoveryOutcome({
    outcome,
    recoveryAttemptId: claim.recoveryAttemptId,
    claimToken: claim.claimToken,
    environment: input.environment,
    repository: input.repository,
  });
}

export async function runBillingCheckoutDirectRecovery(input: {
  checkoutSessionId: string;
  environment: BillingEnvironment;
  leaseSeconds: number;
  providerStoreId: string;
  now: () => Date;
  repository: BillingCheckoutRecoveryRepository;
  provider: CheckoutDirectRecoveryProviderGateway;
}): Promise<BillingCheckoutDirectRecoveryResult> {
  const claim = await input.repository.claimCheckoutRecovery({
    checkoutSessionId: input.checkoutSessionId,
    environment: input.environment,
    leaseSeconds: input.leaseSeconds,
  });
  if (claim.claimOutcome !== "claimed") {
    return { outcome: claim.claimOutcome };
  }
  return runClaimedDirectRecovery({ ...input, claim });
}

export async function runBillingCheckoutBoundedRecovery(input: {
  checkoutSessionId: string;
  environment: BillingEnvironment;
  leaseSeconds: number;
  pageSize: number;
  maxPages: number;
  providerStoreId: string;
  now: () => Date;
  repository: BillingCheckoutRecoveryRepository;
  provider: CheckoutRecoveryProviderGateway;
}): Promise<BillingCheckoutDirectRecoveryResult> {
  const claim = await input.repository.claimCheckoutRecovery({
    checkoutSessionId: input.checkoutSessionId,
    environment: input.environment,
    leaseSeconds: input.leaseSeconds,
  });
  if (claim.claimOutcome !== "claimed") return { outcome: claim.claimOutcome };
  if (
    !claim.recoveryAttemptId || !claim.claimToken || claim.ledgerStatus !== "creating" ||
    claim.environment !== input.environment || claim.provider !== "lemonsqueezy" ||
    claim.checkoutSessionId !== input.checkoutSessionId
  ) {
    return { outcome: "claim_lost" };
  }

  if (claim.providerSessionId) {
    const direct = await runClaimedDirectRecovery({
      claim,
      checkoutSessionId: input.checkoutSessionId,
      environment: input.environment,
      providerStoreId: input.providerStoreId,
      now: input.now,
      repository: input.repository,
      provider: input.provider,
    });
    return direct;
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

      const firstPageUrl = input.provider.buildFirstListPageUrl({
        storeId: mapping.storeId,
        variantId: mapping.variantId,
        pageSize: input.pageSize,
      });
      let reviewedCandidates = 0;
      const search = await searchLemonSqueezyCheckoutPages({
        ledger,
        firstPageUrl,
        maxPages: input.maxPages,
        fetchPage: async (url) => {
          const page = await input.provider.fetchListPage(url, {
            storeId: mapping.storeId,
            variantId: mapping.variantId,
          });
          reviewedCandidates += page.checkouts.length;
          if (
            page.checkouts.length > input.pageSize ||
            reviewedCandidates > input.pageSize * input.maxPages
          ) {
            throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
          }
          return page;
        },
      });
      if (search.outcome === "exact_match") {
        const validated = validateCheckoutForRecoveryFinalization({ checkout: search.checkout, ledger, now: input.now() });
        if (validated) {
          const finalized = await finalizeExactMatch({ checkout: search.checkout, ...validated, recoveryAttemptId: claim.recoveryAttemptId, claimToken: claim.claimToken, environment: input.environment, repository: input.repository });
          return finalized;
        }
        outcome = "invalid_candidate";
      } else {
        outcome = search.outcome === "search_exhausted_not_found"
            ? "provider_not_found"
            : search.outcome;
      }
    }
  } catch (error) {
    outcome = providerErrorOutcome(error);
  }

  const completed = await completeRecoveryOutcome({
    recoveryAttemptId: claim.recoveryAttemptId,
    claimToken: claim.claimToken,
    environment: input.environment,
    outcome,
    repository: input.repository,
  });
  return completed;
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
  return (await runBillingCheckoutBoundedRecovery(input)).outcome;
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

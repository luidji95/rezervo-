import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import {
  resolveLemonSqueezyProviderConfig,
  type LemonSqueezyProviderConfig,
  type LemonSqueezyProviderEnvironment,
} from "../config/lemonSqueezyProviderConfigCore.ts";
import { expectedLemonSqueezyTestMode } from "../config/billingEnvironment.ts";

const API_ORIGIN = "https://api.lemonsqueezy.com";
const CHECKOUT_PATH = "/v1/checkouts";
const JSON_API = "application/vnd.api+json";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const RFC3339_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const CHECKOUT_RECOVERY_WINDOW_BEFORE_MS = 5 * 60 * 1000;
export const CHECKOUT_RECOVERY_WINDOW_AFTER_MS = 35 * 60 * 1000;
export const CHECKOUT_RECOVERY_MAX_PAGES = 10;

export type LemonSqueezyRetrievedCheckout = {
  providerCheckoutId: string;
  storeId: string;
  variantId: string;
  customCheckoutSessionId: string | null;
  customSalonId: string | null;
  customPlanCode: "starter" | "pro" | null;
  customIdempotencyKey: string | null;
  testMode: boolean;
  checkoutUrl: string;
  expiresAt: string | null;
  providerCreatedAt: string;
  providerUpdatedAt: string;
};

export type LemonSqueezyCheckoutRetrievalErrorKind =
  | "configuration_error"
  | "provider_not_found"
  | "provider_unavailable"
  | "invalid_provider_response";

export class LemonSqueezyCheckoutRetrievalError extends Error {
  readonly kind: LemonSqueezyCheckoutRetrievalErrorKind;
  constructor(kind: LemonSqueezyCheckoutRetrievalErrorKind) {
    super(`LEMONSQUEEZY_CHECKOUT_${kind.toUpperCase()}`);
    this.name = "LemonSqueezyCheckoutRetrievalError";
    this.kind = kind;
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return value as JsonObject;
}

function providerId(value: unknown): string {
  if ((typeof value !== "string" && typeof value !== "number") || !POSITIVE_INTEGER_PATTERN.test(String(value))) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return String(value);
}

function date(value: unknown, nullable = false): string | null {
  if (nullable && (value === null || value === undefined)) return null;
  if (
    typeof value !== "string" ||
    !RFC3339_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return value;
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return value;
}

function optionalPlan(value: unknown): "starter" | "pro" | null {
  if (value === undefined || value === null) return null;
  if (value !== "starter" && value !== "pro") {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return value;
}

function httpsUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return parsed.toString();
}

function normalizeCheckoutResource(resource: unknown): LemonSqueezyRetrievedCheckout {
  const data = object(resource);
  if (data.type !== "checkouts") {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  const attributes = object(data.attributes);
  if (typeof attributes.test_mode !== "boolean") {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  const createdAt = date(attributes.created_at)!;
  const updatedAt = date(attributes.updated_at)!;
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }

  const checkoutData = attributes.checkout_data === undefined || attributes.checkout_data === null
    ? null
    : object(attributes.checkout_data);
  const custom = checkoutData?.custom === undefined || checkoutData.custom === null
    ? null
    : object(checkoutData.custom);

  return {
    providerCheckoutId: providerId(data.id),
    storeId: providerId(attributes.store_id),
    variantId: providerId(attributes.variant_id),
    customCheckoutSessionId: optionalUuid(custom?.checkout_session_id),
    customSalonId: optionalUuid(custom?.salon_id),
    customPlanCode: optionalPlan(custom?.plan_code),
    customIdempotencyKey: optionalUuid(custom?.idempotency_key),
    testMode: attributes.test_mode,
    checkoutUrl: httpsUrl(attributes.url),
    expiresAt: date(attributes.expires_at, true),
    providerCreatedAt: createdAt,
    providerUpdatedAt: updatedAt,
  };
}

export function parseLemonSqueezyCheckoutResponse(payload: unknown): LemonSqueezyRetrievedCheckout {
  return normalizeCheckoutResource(object(payload).data);
}

export function resolveLemonSqueezyCheckoutRetrievalConfig<Environment extends BillingEnvironment>(
  runtimeEnvironment: LemonSqueezyProviderEnvironment,
  trustedEnvironment: Environment,
) {
  return resolveLemonSqueezyProviderConfig(runtimeEnvironment, trustedEnvironment);
}

function encodedProviderCheckoutId(id: string) {
  return encodeURIComponent(providerId(id));
}

export function buildLemonSqueezyCheckoutRetrieveRequest(
  providerCheckoutId: string,
  config: LemonSqueezyProviderConfig,
) {
  return {
    url: `${API_ORIGIN}${CHECKOUT_PATH}/${encodedProviderCheckoutId(providerCheckoutId)}`,
    init: {
      method: "GET",
      headers: { Accept: JSON_API, Authorization: `Bearer ${config.apiKey}` },
      cache: "no-store" as const,
      redirect: "error" as const,
    },
  };
}

export type LemonSqueezyCheckoutListInput = {
  storeId: string;
  variantId: string;
  pageNumber: number;
  pageSize: number;
};

function positivePage(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return value;
}

function rawPositivePage(value: string | null): number {
  if (value === null || !POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  return positivePage(Number(value));
}

export function buildLemonSqueezyCheckoutListRequest(
  input: LemonSqueezyCheckoutListInput,
  config: LemonSqueezyProviderConfig,
) {
  const storeId = providerId(input.storeId);
  const variantId = providerId(input.variantId);
  if (storeId !== config.storeId) {
    throw new LemonSqueezyCheckoutRetrievalError("configuration_error");
  }
  const query = new URLSearchParams({
    "filter[store_id]": storeId,
    "filter[variant_id]": variantId,
    "page[number]": String(positivePage(input.pageNumber)),
    "page[size]": String(positivePage(input.pageSize)),
  });
  return {
    url: `${API_ORIGIN}${CHECKOUT_PATH}?${query.toString()}`,
    init: {
      method: "GET",
      headers: { Accept: JSON_API, Authorization: `Bearer ${config.apiKey}` },
      cache: "no-store" as const,
      redirect: "error" as const,
    },
  };
}

export type LemonSqueezyCheckoutPage = {
  checkouts: LemonSqueezyRetrievedCheckout[];
  nextPageUrl: string | null;
};

function validateCheckoutListPageUrl(value: unknown, expectedStoreId: string, expectedVariantId: string): string {
  if (typeof value !== "string") throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response"); }
  const allowed = new Set(["filter[store_id]", "filter[variant_id]", "page[number]", "page[size]"]);
  const required = [...allowed];
  if (
    url.protocol !== "https:" || url.hostname !== "api.lemonsqueezy.com" || url.port ||
    url.username || url.password || url.pathname !== CHECKOUT_PATH || url.hash ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    required.some((key) => url.searchParams.getAll(key).length !== 1) ||
    url.searchParams.get("filter[store_id]") !== expectedStoreId ||
    url.searchParams.get("filter[variant_id]") !== expectedVariantId
  ) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  rawPositivePage(url.searchParams.get("page[number]"));
  rawPositivePage(url.searchParams.get("page[size]"));
  return url.toString();
}

function validateNextPageUrl(value: unknown, expectedStoreId: string, expectedVariantId: string): string | null {
  if (value === null || value === undefined) return null;
  return validateCheckoutListPageUrl(value, expectedStoreId, expectedVariantId);
}

function isJsonApiContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === JSON_API;
}

export function parseLemonSqueezyCheckoutListResponse(
  payload: unknown,
  expected: { storeId: string; variantId: string },
): LemonSqueezyCheckoutPage {
  const envelope = object(payload);
  if (!Array.isArray(envelope.data)) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  if (envelope.meta !== undefined && envelope.meta !== null) object(envelope.meta);
  const checkouts = envelope.data.map(normalizeCheckoutResource);
  for (let index = 1; index < checkouts.length; index += 1) {
    if (Date.parse(checkouts[index]!.providerCreatedAt) > Date.parse(checkouts[index - 1]!.providerCreatedAt)) {
      throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
    }
  }
  const links = envelope.links === undefined || envelope.links === null ? {} : object(envelope.links);
  return {
    checkouts,
    nextPageUrl: validateNextPageUrl(links.next, expected.storeId, expected.variantId),
  };
}

type LemonSqueezyCheckoutRequestKind = "retrieve" | "list";

async function parseJsonApiResponse(response: Response, requestKind: LemonSqueezyCheckoutRequestKind) {
  if (response.status === 401 || response.status === 403) throw new LemonSqueezyCheckoutRetrievalError("configuration_error");
  if (response.status === 404) {
    throw new LemonSqueezyCheckoutRetrievalError(
      requestKind === "retrieve" ? "provider_not_found" : "invalid_provider_response",
    );
  }
  if (response.status === 429 || response.status >= 500) throw new LemonSqueezyCheckoutRetrievalError("provider_unavailable");
  if (!response.ok) throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  if (!isJsonApiContentType(response.headers.get("content-type"))) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  try { return await response.json() as unknown; }
  catch { throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response"); }
}

export class LemonSqueezyCheckoutRetrievalClient {
  private readonly config: LemonSqueezyProviderConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(
    config: LemonSqueezyProviderConfig,
    fetchImpl: typeof fetch,
    timeoutMs = 10_000,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  private async request(
    request: ReturnType<typeof buildLemonSqueezyCheckoutRetrieveRequest>,
    requestKind: LemonSqueezyCheckoutRequestKind,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(request.url, { ...request.init, signal: controller.signal });
      return await parseJsonApiResponse(response, requestKind);
    } catch (error) {
      if (error instanceof LemonSqueezyCheckoutRetrievalError) throw error;
      throw new LemonSqueezyCheckoutRetrievalError("provider_unavailable");
    } finally { clearTimeout(timeout); }
  }

  async retrieveById(providerCheckoutId: string) {
    const payload = await this.request(
      buildLemonSqueezyCheckoutRetrieveRequest(providerCheckoutId, this.config),
      "retrieve",
    );
    const checkout = parseLemonSqueezyCheckoutResponse(payload);
    if (checkout.testMode !== expectedLemonSqueezyTestMode(this.config.environment)) {
      throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
    }
    return checkout;
  }

  async list(input: LemonSqueezyCheckoutListInput) {
    const request = buildLemonSqueezyCheckoutListRequest(input, this.config);
    const payload = await this.request(request, "list");
    const page = parseLemonSqueezyCheckoutListResponse(payload, input);
    if (page.checkouts.some((checkout) => checkout.testMode !== expectedLemonSqueezyTestMode(this.config.environment))) {
      throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
    }
    return page;
  }

  async listPageByUrl(
    url: string,
    expected: { storeId: string; variantId: string },
  ) {
    const trustedUrl = validateCheckoutListPageUrl(
      url,
      expected.storeId,
      expected.variantId,
    );
    const payload = await this.request(
      {
        url: trustedUrl,
        init: {
          method: "GET",
          headers: {
            Accept: JSON_API,
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          cache: "no-store" as const,
          redirect: "error" as const,
        },
      },
      "list",
    );
    const page = parseLemonSqueezyCheckoutListResponse(payload, expected);
    if (
      page.checkouts.some(
        (checkout) =>
          checkout.testMode !==
          expectedLemonSqueezyTestMode(this.config.environment),
      )
    ) {
      throw new LemonSqueezyCheckoutRetrievalError(
        "invalid_provider_response",
      );
    }
    return page;
  }
}

export type CheckoutRecoveryLedgerFacts = {
  ledgerId: string;
  environment: BillingEnvironment;
  expectedStoreId: string;
  expectedVariantId: string;
  localCreatedAt: string;
  localExpiresAt: string | null;
  expectedSalonId: string;
  expectedPlanCode: "starter" | "pro";
  expectedIdempotencyKey: string;
  knownProviderCheckoutIds: ReadonlySet<string>;
};

export type CheckoutCorrelationResult =
  | { outcome: "exact_match"; checkout: LemonSqueezyRetrievedCheckout }
  | { outcome: "not_found" }
  | { outcome: "ambiguous" }
  | { outcome: "invalid_candidate" };

function validatesExactCandidate(candidate: LemonSqueezyRetrievedCheckout, ledger: CheckoutRecoveryLedgerFacts) {
  const created = Date.parse(candidate.providerCreatedAt);
  const local = Date.parse(ledger.localCreatedAt);
  if (!Number.isFinite(local)) return false;
  return POSITIVE_INTEGER_PATTERN.test(candidate.providerCheckoutId) &&
    candidate.storeId === ledger.expectedStoreId &&
    candidate.variantId === ledger.expectedVariantId &&
    candidate.testMode === expectedLemonSqueezyTestMode(ledger.environment) &&
    created >= local - CHECKOUT_RECOVERY_WINDOW_BEFORE_MS &&
    created <= local + CHECKOUT_RECOVERY_WINDOW_AFTER_MS &&
    !ledger.knownProviderCheckoutIds.has(candidate.providerCheckoutId) &&
    (candidate.customSalonId === null || candidate.customSalonId === ledger.expectedSalonId) &&
    (candidate.customPlanCode === null || candidate.customPlanCode === ledger.expectedPlanCode) &&
    (candidate.customIdempotencyKey === null || candidate.customIdempotencyKey === ledger.expectedIdempotencyKey);
}

export function correlateLemonSqueezyCheckoutCandidates(
  ledger: CheckoutRecoveryLedgerFacts,
  candidates: readonly LemonSqueezyRetrievedCheckout[],
): CheckoutCorrelationResult {
  const sameLedger = candidates.filter((candidate) => candidate.customCheckoutSessionId === ledger.ledgerId);
  if (sameLedger.length === 0) return { outcome: "not_found" };
  if (sameLedger.some((candidate) => !validatesExactCandidate(candidate, ledger))) return { outcome: "invalid_candidate" };
  if (sameLedger.length > 1) return { outcome: "ambiguous" };
  return { outcome: "exact_match", checkout: sameLedger[0]! };
}

export type CheckoutRecoveryPageResult = CheckoutCorrelationResult | { outcome: "page_not_found" };

export function correlateLemonSqueezyCheckoutPage(
  ledger: CheckoutRecoveryLedgerFacts,
  page: LemonSqueezyCheckoutPage,
): CheckoutRecoveryPageResult {
  const result = correlateLemonSqueezyCheckoutCandidates(ledger, page.checkouts);
  return result.outcome === "not_found" ? { outcome: "page_not_found" } : result;
}

export type CheckoutRecoverySearchResult =
  | Exclude<CheckoutCorrelationResult, { outcome: "not_found" }>
  | { outcome: "search_exhausted_not_found" }
  | { outcome: "pagination_limit_reached" };

export async function searchLemonSqueezyCheckoutPages(input: {
  ledger: CheckoutRecoveryLedgerFacts;
  firstPageUrl: string;
  fetchPage: (url: string) => Promise<LemonSqueezyCheckoutPage>;
  maxPages?: number;
}): Promise<CheckoutRecoverySearchResult> {
  const maxPages = input.maxPages ?? CHECKOUT_RECOVERY_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > CHECKOUT_RECOVERY_MAX_PAGES) {
    throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
  }
  let next: string | null = validateCheckoutListPageUrl(
    input.firstPageUrl,
    input.ledger.expectedStoreId,
    input.ledger.expectedVariantId,
  );
  const matches: LemonSqueezyRetrievedCheckout[] = [];
  const lowerBound = Date.parse(input.ledger.localCreatedAt) - CHECKOUT_RECOVERY_WINDOW_BEFORE_MS;
  let previousOldestCreatedAt = Number.POSITIVE_INFINITY;
  for (let pageNumber = 1; pageNumber <= maxPages && next; pageNumber += 1) {
    const page = await input.fetchPage(next);
    for (let index = 0; index < page.checkouts.length; index += 1) {
      const createdAt = Date.parse(page.checkouts[index]!.providerCreatedAt);
      const preceding = index === 0
        ? previousOldestCreatedAt
        : Date.parse(page.checkouts[index - 1]!.providerCreatedAt);
      if (!Number.isFinite(createdAt) || createdAt > preceding) {
        throw new LemonSqueezyCheckoutRetrievalError("invalid_provider_response");
      }
    }
    const result = correlateLemonSqueezyCheckoutCandidates(input.ledger, page.checkouts);
    if (result.outcome === "invalid_candidate") return result;
    if (result.outcome === "ambiguous") return result;
    if (result.outcome === "exact_match") matches.push(result.checkout);
    if (matches.length > 1) return { outcome: "ambiguous" };

    const oldest = page.checkouts.at(-1);
    if (oldest) previousOldestCreatedAt = Date.parse(oldest.providerCreatedAt);
    if (oldest && Date.parse(oldest.providerCreatedAt) < lowerBound) {
      return matches.length === 1 ? { outcome: "exact_match", checkout: matches[0]! } : { outcome: "search_exhausted_not_found" };
    }
    next = page.nextPageUrl === null
      ? null
      : validateCheckoutListPageUrl(
        page.nextPageUrl,
        input.ledger.expectedStoreId,
        input.ledger.expectedVariantId,
      );
    if (!next) return matches.length === 1 ? { outcome: "exact_match", checkout: matches[0]! } : { outcome: "search_exhausted_not_found" };
  }
  return { outcome: "pagination_limit_reached" };
}

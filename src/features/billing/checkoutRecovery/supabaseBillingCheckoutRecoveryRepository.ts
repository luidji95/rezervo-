import type {
  BillingCheckoutRecoveryRepository,
  CheckoutRecoveryAuditOutcome,
  CheckoutRecoveryClaim,
  CheckoutRecoveryCompletion,
  CheckoutRecoveryProviderMapping,
} from "./billingCheckoutRecoveryRepository";
import type { BillingEnvironment } from "../config/billingEnvironment";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID_PATTERN = /^[1-9]\d*$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const CLAIM_OUTCOMES = new Set(["claimed", "already_open", "already_completed", "already_claimed", "manual_review"]);
const CHECKOUT_STATUSES = new Set(["creating", "open", "completed", "failed", "expired", "cancelled"]);
const AUDIT_OUTCOMES = new Set<CheckoutRecoveryAuditOutcome>([
  "still_pending", "provider_not_found", "provider_unavailable", "invalid_candidate",
  "ambiguous", "pagination_limit_reached", "manual_review", "configuration_error",
  "invalid_provider_response",
]);

type QueryResult = { data: unknown; error: unknown };
type RpcBuilder = { maybeSingle(): Promise<QueryResult> };
type FilterBuilder = PromiseLike<QueryResult> & {
  eq(column: string, value: unknown): FilterBuilder;
  neq(column: string, value: unknown): FilterBuilder;
  not(column: string, operator: string, value: unknown): FilterBuilder;
};
export type CheckoutRecoverySupabaseClient = {
  rpc(name: string, args: Record<string, unknown>): RpcBuilder;
  from(table: string): { select(columns: string): FilterBuilder };
};

export class BillingCheckoutRecoveryRepositoryError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "BillingCheckoutRecoveryRepositoryError";
  }
}

function fail(code: string): never { throw new BillingCheckoutRecoveryRepositoryError(code); }
function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}
function uuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(code);
  return value;
}
function timestamp(value: unknown, nullable: true, code: string): string | null;
function timestamp(value: unknown, nullable: false, code: string): string;
function timestamp(value: unknown, nullable: boolean, code: string) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") fail(code);
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) fail(code);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]! ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
    !Number.isFinite(Date.parse(value))
  ) fail(code);
  return value;
}
function providerId(value: unknown, nullable: true, code: string): string | null;
function providerId(value: unknown, nullable: false, code: string): string;
function providerId(value: unknown, nullable: boolean, code: string) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) fail(code);
  return value;
}

export function parseCheckoutRecoveryClaimRow(value: unknown, trustedEnvironment: BillingEnvironment): CheckoutRecoveryClaim {
  const code = "BILLING_CHECKOUT_RECOVERY_CLAIM_INVALID";
  const row = object(value, code);
  if (typeof row.claim_outcome !== "string" || !CLAIM_OUTCOMES.has(row.claim_outcome)) fail(code);
  if (row.provider !== "lemonsqueezy" || row.environment !== trustedEnvironment) fail(code);
  if (typeof row.ledger_status !== "string" || !CHECKOUT_STATUSES.has(row.ledger_status)) fail(code);
  const claimed = row.claim_outcome === "claimed";
  const statusMatchesOutcome =
    (row.claim_outcome === "claimed" && row.ledger_status === "creating") ||
    (row.claim_outcome === "already_claimed" && row.ledger_status === "creating") ||
    (row.claim_outcome === "already_open" && row.ledger_status === "open") ||
    (row.claim_outcome === "already_completed" && row.ledger_status === "completed") ||
    (row.claim_outcome === "manual_review" && ["failed", "expired", "cancelled"].includes(row.ledger_status as string));
  if (!statusMatchesOutcome) fail(code);
  if (!claimed && (row.recovery_attempt_id !== null || row.claim_token !== null)) fail(code);
  return {
    claimOutcome: row.claim_outcome as CheckoutRecoveryClaim["claimOutcome"],
    recoveryAttemptId: claimed ? uuid(row.recovery_attempt_id, code) : null,
    claimToken: claimed ? uuid(row.claim_token, code) : null,
    checkoutSessionId: uuid(row.checkout_session_id, code),
    ledgerStatus: row.ledger_status,
    provider: "lemonsqueezy",
    environment: trustedEnvironment,
    providerSessionId: claimed ? providerId(row.provider_session_id, true, code) : null,
    requestedPlanId: uuid(row.requested_plan_id, code),
    salonId: uuid(row.salon_id, code),
    idempotencyKey: uuid(row.idempotency_key, code),
    ledgerCreatedAt: timestamp(row.ledger_created_at, false, code),
    ledgerExpiresAt: timestamp(row.ledger_expires_at, true, code),
  };
}

export function parseCheckoutRecoveryCompletionRow(value: unknown): CheckoutRecoveryCompletion {
  const code = "BILLING_CHECKOUT_RECOVERY_COMPLETION_INVALID";
  const row = object(value, code);
  if (row.completion_outcome === "completed" || row.completion_outcome === "already_completed") {
    if (row.status !== "completed" || typeof row.outcome !== "string" || !AUDIT_OUTCOMES.has(row.outcome as CheckoutRecoveryAuditOutcome)) fail(code);
    return { completionOutcome: row.completion_outcome, status: "completed", outcome: row.outcome };
  }
  if (row.completion_outcome === "claim_lost") {
    if ((row.status !== "abandoned" && row.status !== null) || (row.outcome !== "claim_lost" && row.outcome !== null)) fail(code);
    return { completionOutcome: "claim_lost", status: row.status, outcome: row.outcome };
  }
  fail(code);
}

export function parseCheckoutRecoveryMappingRows(value: unknown): CheckoutRecoveryProviderMapping | null {
  const code = "BILLING_CHECKOUT_RECOVERY_MAPPING_INVALID";
  if (!Array.isArray(value)) fail(code);
  if (value.length === 0) return null;
  if (value.length !== 1) fail(code);
  const row = object(value[0], code);
  const plans = object(row.plans, code);
  if (plans.slug !== "starter" && plans.slug !== "pro") fail(code);
  return {
    storeId: providerId(row.provider_store_id, false, code),
    variantId: providerId(row.provider_variant_id, false, code),
    planCode: plans.slug,
  };
}

export function parseKnownProviderCheckoutIdRows(value: unknown): ReadonlySet<string> {
  const code = "BILLING_CHECKOUT_RECOVERY_KNOWN_IDS_INVALID";
  if (!Array.isArray(value)) fail(code);
  const ids = new Set<string>();
  for (const item of value) {
    const providerSessionId = object(item, code).provider_session_id;
    if (typeof providerSessionId !== "string") fail(code);
    if (PROVIDER_ID_PATTERN.test(providerSessionId)) ids.add(providerSessionId);
    else if (!UUID_PATTERN.test(providerSessionId)) fail(code);
  }
  return ids;
}

export class SupabaseBillingCheckoutRecoveryRepository implements BillingCheckoutRecoveryRepository {
  private readonly client: CheckoutRecoverySupabaseClient;
  constructor(client: CheckoutRecoverySupabaseClient) {
    this.client = client;
  }

  async claimCheckoutRecovery(input: { checkoutSessionId: string; environment: BillingEnvironment; leaseSeconds: number }) {
    const { data, error } = await this.client.rpc("claim_billing_checkout_recovery_v1", {
      p_checkout_session_id: input.checkoutSessionId,
      p_environment: input.environment,
      p_lease_duration: `${input.leaseSeconds} seconds`,
    }).maybeSingle();
    if (error || !data) fail("BILLING_CHECKOUT_RECOVERY_CLAIM_FAILED");
    return parseCheckoutRecoveryClaimRow(data, input.environment);
  }

  async completeCheckoutRecoveryAttempt(input: { recoveryAttemptId: string; claimToken: string; environment: BillingEnvironment; outcome: CheckoutRecoveryAuditOutcome }) {
    const { data, error } = await this.client.rpc("complete_billing_checkout_recovery_attempt_v1", {
      p_recovery_attempt_id: input.recoveryAttemptId,
      p_claim_token: input.claimToken,
      p_environment: input.environment,
      p_outcome: input.outcome,
    }).maybeSingle();
    if (error || !data) fail("BILLING_CHECKOUT_RECOVERY_COMPLETE_FAILED");
    return parseCheckoutRecoveryCompletionRow(data);
  }

  async resolveTrustedProviderMapping(input: { requestedPlanId: string; environment: BillingEnvironment }) {
    const { data, error } = await this.client.from("billing_provider_prices")
      .select("provider_store_id,provider_variant_id,plans!inner(slug)")
      .eq("provider", "lemonsqueezy").eq("environment", input.environment)
      .eq("billing_interval", "monthly").eq("plan_id", input.requestedPlanId).eq("is_active", true);
    if (error) fail("BILLING_CHECKOUT_RECOVERY_MAPPING_FAILED");
    return parseCheckoutRecoveryMappingRows(data);
  }

  async listKnownProviderCheckoutIds(input: { checkoutSessionId: string; environment: BillingEnvironment }) {
    const { data, error } = await this.client.from("billing_checkout_sessions")
      .select("provider_session_id").eq("provider", "lemonsqueezy")
      .eq("environment", input.environment).neq("id", input.checkoutSessionId)
      .not("provider_session_id", "is", null);
    if (error) fail("BILLING_CHECKOUT_RECOVERY_LEDGER_LOOKUP_FAILED");
    return parseKnownProviderCheckoutIdRows(data);
  }
}

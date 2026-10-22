import assert from "node:assert/strict";
import test from "node:test";
import { parseRecoveryArgs, RecoveryUsageError, type RecoveryApply } from "./billingRecoveryArgs.ts";
import { BillingRecoveryConfigError, resolveBillingRecoveryConfig } from "./billingRecoveryConfig.ts";
import { formatRecoveryReport, runBillingRecovery, type BillingRecoveryRepository } from "./billingRecoveryCore.ts";
import { BillingReconciliationProviderError, type BillingReconciliationProvider } from "../reconciliation/billingReconciliationProvider.ts";
import type { NormalizedLemonSqueezySubscription } from "../lemonSqueezy/lemonSqueezySubscriptionObjectCore.ts";
import type { BillingEnvironment } from "../config/billingEnvironment.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(64);
const APPLY = ["--apply", "--review-token", TOKEN, "--ticket", "OPS-42", "--reason", "payment confirmed by provider", "--operator", "ops@example.invalid"];

const snapshot = (patch: Partial<NormalizedLemonSqueezySubscription> = {}): NormalizedLemonSqueezySubscription => ({
  providerSubscriptionId: "900", providerStoreId: "30", providerCustomerId: "77-secret-customer", providerOrderId: "5",
  providerProductId: "p1", providerVariantId: "v1", providerStatus: "active", providerCancelled: false,
  providerPauseMode: null, providerPauseResumesAt: null, providerTrialEndsAt: null,
  providerRenewsAt: "2026-12-01T00:00:00Z", providerEndsAt: null,
  providerCreatedAt: "2026-07-01T00:00:00Z", providerUpdatedAt: "2026-10-01T00:00:00Z", testMode: true, ...patch,
});

function harness(environment: BillingEnvironment = "test", options: { snap?: NormalizedLemonSqueezySubscription; providerError?: unknown; local?: { providerSubscriptionId: string } | null; planVerdict?: string; applyOutcome?: string; rpcFails?: boolean } = {}) {
  const calls = { provider: 0, getLocal: 0, planEvent: 0, applyEvent: 0, planSnap: 0, applySnap: 0 };
  const changeCalls = { getChange: 0, planChange: 0, applyChange: 0 };
  const seen: { apply?: RecoveryApply } = {};
  const repository: BillingRecoveryRepository = {
    async getLinkedSubscription() { calls.getLocal++; return options.local === undefined ? { providerSubscriptionId: "900" } : options.local; },
    async planEventReprocess() { calls.planEvent++; if (options.rpcFails) throw new Error("private rpc failure"); return { verdict: options.planVerdict ?? "eligible", errorCode: null, reviewToken: TOKEN, details: { "Event name": "subscription_updated" } }; },
    async applyEventReprocess(_e, _id, apply) { calls.applyEvent++; seen.apply = apply; return { outcome: options.applyOutcome ?? "reprocessed", errorCode: null }; },
    async planSnapshot() { calls.planSnap++; return { verdict: options.planVerdict ?? "eligible", errorCode: null, reviewToken: TOKEN, details: { Proposed: "status=active" } }; },
    async applySnapshot(_e, _id, _s, apply) { calls.applySnap++; seen.apply = apply; return { outcome: options.applyOutcome ?? "applied", errorCode: null }; },
    async getPlanChange() { changeCalls.getChange++; return options.local === undefined ? { providerSubscriptionId: "900" } : options.local; },
    async planPlanChange() { changeCalls.planChange++; return { verdict: options.planVerdict ?? "eligible", errorCode: options.planVerdict === "unsupported" ? "recovery_plan_change_e1_order_unprovable" : null, reviewToken: TOKEN, details: { Proposed: "record_observed" } }; },
    async applyPlanChange(_e, _id, _s, apply) { changeCalls.applyChange++; seen.apply = apply; return { outcome: options.applyOutcome ?? "recorded", errorCode: null }; },
  };
  const provider: BillingReconciliationProvider = {
    async retrieveSubscription() {
      calls.provider++;
      if (options.providerError) throw options.providerError;
      return { snapshot: options.snap ?? snapshot({ testMode: environment === "test" }), rateLimitRemaining: 10 };
    },
  };
  const run = (argv: string[]) => runBillingRecovery({ command: parseRecoveryArgs(argv), environment, storeId: "30", repository, provider });
  return { calls, changeCalls, seen, run };
}

// ---- argument parsing -------------------------------------------------------
test("dry-run is the default and apply needs every audit input", () => {
  assert.deepEqual(parseRecoveryArgs(["event", "--event", ID]), { kind: "event", targetId: ID, apply: null });
  assert.deepEqual(parseRecoveryArgs(["subscription", "--subscription", ID.toUpperCase()]).apply, null);
  const apply = parseRecoveryArgs(["event", "--event", ID, ...APPLY]);
  assert.equal(apply.apply?.ticket, "OPS-42");
  for (const missing of ["--review-token", "--ticket", "--reason", "--operator"]) {
    const index = APPLY.indexOf(missing);
    const without = APPLY.filter((_, i) => i !== index && i !== index + 1);
    assert.throws(() => parseRecoveryArgs(["event", "--event", ID, ...without]), RecoveryUsageError, missing);
  }
  assert.throws(() => parseRecoveryArgs(["event", "--event", ID, "--review-token", TOKEN]), /only valid together with --apply/);
  assert.throws(() => parseRecoveryArgs(["event", "--event", ID, ...APPLY.map((v) => (v === "payment confirmed by provider" ? "short" : v))]), /--reason/);
});

test("environment, credentials and unknown flags can never be passed on the command line", () => {
  for (const extra of [["--environment", "live"], ["--api-key", "x"], ["--service-key", "x"], ["--database-url", "x"], ["--secret", "x"], ["--provider-subscription-id", "1"], ["--force"], ["positional"]]) {
    assert.throws(() => parseRecoveryArgs(["event", "--event", ID, ...extra]), RecoveryUsageError, extra[0]);
  }
  assert.throws(() => parseRecoveryArgs(["event", "--event", "not-a-uuid"]), /UUID/);
  assert.throws(() => parseRecoveryArgs(["event", "--subscription", ID]), RecoveryUsageError);
  assert.throws(() => parseRecoveryArgs(["bulk", "--all"]), RecoveryUsageError);
  assert.throws(() => parseRecoveryArgs(["event", "--event", ID, "--event", ID]), /twice/);
  assert.throws(() => parseRecoveryArgs([]), RecoveryUsageError);
});

// ---- configuration ----------------------------------------------------------
test("recovery is default-off, environment-bound and has no test/live credential fallback", () => {
  const base = { BILLING_PROVIDER: "lemonsqueezy", LEMONSQUEEZY_API_KEY: "test-key", LEMONSQUEEZY_STORE_ID: "30", LEMONSQUEEZY_LIVE_API_KEY: "live-key", LEMONSQUEEZY_LIVE_STORE_ID: "40" };
  assert.throws(() => resolveBillingRecoveryConfig({ ...base, BILLING_ENVIRONMENT: "test" }), BillingRecoveryConfigError);
  assert.throws(() => resolveBillingRecoveryConfig({ ...base, BILLING_ENVIRONMENT: "test", BILLING_OPERATOR_RECOVERY_ENABLED: "yes" }), BillingRecoveryConfigError);
  assert.deepEqual(resolveBillingRecoveryConfig({ ...base, BILLING_ENVIRONMENT: "test", BILLING_OPERATOR_RECOVERY_ENABLED: "true" }), { environment: "test", apiKey: "test-key", storeId: "30" });
  assert.deepEqual(resolveBillingRecoveryConfig({ ...base, BILLING_ENVIRONMENT: "live", BILLING_OPERATOR_RECOVERY_ENABLED: "true" }), { environment: "live", apiKey: "live-key", storeId: "40" });
  for (const broken of [{ BILLING_ENVIRONMENT: "production" }, { BILLING_ENVIRONMENT: undefined }, { BILLING_ENVIRONMENT: "live", LEMONSQUEEZY_LIVE_API_KEY: undefined }, { BILLING_ENVIRONMENT: "test", BILLING_PROVIDER: "stripe" }]) {
    assert.throws(() => resolveBillingRecoveryConfig({ ...base, BILLING_OPERATOR_RECOVERY_ENABLED: "true", ...broken }), BillingRecoveryConfigError);
  }
});

// ---- orchestration ----------------------------------------------------------
test("event dry-run only plans: no apply, no provider", async () => {
  const h = harness();
  const result = await h.run(["event", "--event", ID]);
  assert.equal(result.status, "eligible");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(h.calls, { provider: 0, getLocal: 0, planEvent: 1, applyEvent: 0, planSnap: 0, applySnap: 0 });
  assert.match(formatRecoveryReport(result), /To apply after review: .* --review-token a{64} --ticket <ref>/);
});

test("event apply forwards the audited inputs once and never plans first", async () => {
  const h = harness();
  const result = await h.run(["event", "--event", ID, ...APPLY]);
  assert.equal(result.status, "reprocessed");
  assert.equal(h.calls.applyEvent, 1);
  assert.equal(h.calls.planEvent, 0);
  assert.deepEqual(h.seen.apply, { reviewToken: TOKEN, ticket: "OPS-42", reason: "payment confirmed by provider", operator: "ops@example.invalid" });
});

test("subscription dry-run reads the provider once and does not apply", async () => {
  const h = harness();
  const result = await h.run(["subscription", "--subscription", ID]);
  assert.equal(result.status, "eligible");
  assert.deepEqual(h.calls, { provider: 1, getLocal: 1, planEvent: 0, applyEvent: 0, planSnap: 1, applySnap: 0 });
  assert.equal(result.mode, "dry-run");
});

test("subscription apply re-reads the provider evidence and passes the review token to the database", async () => {
  const h = harness("test");
  const result = await h.run(["subscription", "--subscription", ID, ...APPLY]);
  assert.equal(result.status, "applied");
  assert.deepEqual(h.calls, { provider: 1, getLocal: 1, planEvent: 0, applyEvent: 0, planSnap: 0, applySnap: 1 });
  assert.equal(h.seen.apply?.reviewToken, TOKEN);
});

test("live uses the same flow with live evidence only", async () => {
  const live = harness("live", { snap: snapshot({ testMode: false }) });
  assert.equal((await live.run(["subscription", "--subscription", ID])).status, "eligible");
  const mismatch = harness("live", { snap: snapshot({ testMode: true }) });
  const result = await mismatch.run(["subscription", "--subscription", ID, ...APPLY]);
  assert.equal(result.status, "identity_conflict");
  assert.equal(mismatch.calls.applySnap, 0);
});

test("unlinked subscription stops before any provider call", async () => {
  const h = harness("test", { local: null });
  const result = await h.run(["subscription", "--subscription", ID, ...APPLY]);
  assert.equal(result.status, "not_found");
  assert.equal(result.exitCode, 2);
  assert.equal(h.calls.provider, 0);
  assert.equal(h.calls.applySnap, 0);
});

test("evidence from another subscription, store or environment is rejected before the database", async () => {
  for (const patch of [{ providerSubscriptionId: "901" }, { providerStoreId: "31" }, { testMode: false }]) {
    const h = harness("test", { snap: snapshot(patch) });
    const result = await h.run(["subscription", "--subscription", ID, ...APPLY]);
    assert.equal(result.status, "identity_conflict", JSON.stringify(patch));
    assert.equal(result.exitCode, 2);
    assert.equal(h.calls.planSnap + h.calls.applySnap, 0);
  }
});

test("provider failures are operational, sanitized and never reach apply", async () => {
  for (const kind of ["provider_not_found", "provider_unavailable", "provider_response_invalid", "configuration_error"] as const) {
    const h = harness("test", { providerError: new BillingReconciliationProviderError(kind, "private-detail", false) });
    const result = await h.run(["subscription", "--subscription", ID, ...APPLY]);
    assert.equal(result.status, "operational_failure");
    assert.equal(result.errorCode, kind);
    assert.equal(result.exitCode, 3);
    assert.equal(h.calls.applySnap, 0);
    assert.doesNotMatch(formatRecoveryReport(result), /private-detail/);
  }
  const unknown = harness("test", { providerError: new Error("socket reset with token abc") });
  const result = await unknown.run(["subscription", "--subscription", ID]);
  assert.equal(result.errorCode, "provider_unavailable");
  assert.doesNotMatch(formatRecoveryReport(result), /socket|abc/);
});

test("database failures are sanitized", async () => {
  const h = harness("test", { rpcFails: true });
  const result = await h.run(["event", "--event", ID]);
  assert.equal(result.status, "operational_failure");
  assert.equal(result.errorCode, "database_error");
  assert.equal(result.exitCode, 3);
  assert.doesNotMatch(formatRecoveryReport(result), /private rpc failure/);
});

test("database rejections, stale reviews and parity failures exit non-zero and explain next step", async () => {
  for (const outcome of ["stale", "reason_not_allowed", "environment_mismatch", "same_timestamp_conflict", "plan_change_unsupported", "unsupported_state", "event_busy", "precondition_unmet"]) {
    const h = harness("test", { applyOutcome: outcome });
    const result = await h.run(["event", "--event", ID, ...APPLY]);
    assert.equal(result.status, outcome);
    assert.equal(result.exitCode, 2, outcome);
  }
  const stale = formatRecoveryReport(await harness("test", { applyOutcome: "stale" }).run(["event", "--event", ID, ...APPLY]));
  assert.match(stale, /Run the dry-run again/);
});

test("reports never contain credentials, customer identifiers or provider URLs", async () => {
  const h = harness();
  const text = formatRecoveryReport(await h.run(["subscription", "--subscription", ID]));
  assert.doesNotMatch(text, /77-secret-customer|Bearer|api[_-]?key|https?:\/\//i);
});

// ---- C2 plan-change recovery ---------------------------------------------------
test("plan-change: --change target only, dry-run default, other target flags refused", () => {
  assert.deepEqual(parseRecoveryArgs(["plan-change", "--change", ID]), { kind: "plan-change", targetId: ID, apply: null });
  assert.throws(() => parseRecoveryArgs(["plan-change", "--subscription", ID]), RecoveryUsageError);
  assert.throws(() => parseRecoveryArgs(["plan-change", "--change", ID, "--subscription", ID]), /does not apply/);
  assert.throws(() => parseRecoveryArgs(["plan-change", "--change", ID, "--force-complete"]), RecoveryUsageError);
  assert.equal(parseRecoveryArgs(["plan-change", "--change", ID, ...APPLY]).apply?.ticket, "OPS-42");
});

test("plan-change dry-run reads the provider once and never applies; apply passes the audit inputs", async () => {
  const dry = harness();
  const report = await dry.run(["plan-change", "--change", ID]);
  assert.deepEqual([report.mode, report.status, report.exitCode], ["dry-run", "eligible", 0]);
  assert.deepEqual([dry.calls.provider, dry.changeCalls.planChange, dry.changeCalls.applyChange, dry.calls.planSnap], [1, 1, 0, 0]);
  assert.match(formatRecoveryReport(report), /--change 11111111-1111-4111-8111-111111111111 --apply --review-token/);
  const applied = harness();
  const result = await applied.run(["plan-change", "--change", ID, ...APPLY]);
  assert.deepEqual([result.status, result.exitCode, applied.changeCalls.applyChange], ["recorded", 0, 1]);
  assert.equal(applied.seen.apply?.ticket, "OPS-42");
});

test("plan-change: unsupported verdicts are reported precisely, identity mismatch and missing change stop early", async () => {
  const unsupported = harness("test", { planVerdict: "unsupported" });
  const report = await unsupported.run(["plan-change", "--change", ID]);
  assert.deepEqual([report.status, report.errorCode, report.exitCode], ["unsupported", "recovery_plan_change_e1_order_unprovable", 2]);
  assert.doesNotMatch(formatRecoveryReport(report), /--apply/);
  const foreign = harness("test", { snap: snapshot({ providerStoreId: "999" }) });
  assert.equal((await foreign.run(["plan-change", "--change", ID])).status, "identity_conflict");
  assert.equal(foreign.changeCalls.planChange, 0);
  const missing = harness("test", { local: null });
  assert.deepEqual([(await missing.run(["plan-change", "--change", ID])).errorCode, missing.calls.provider], ["recovery_plan_change_not_found", 0]);
  const providerDown = harness("test", { providerError: new BillingReconciliationProviderError("provider_unavailable", "provider_timeout", false) });
  assert.deepEqual([(await providerDown.run(["plan-change", "--change", ID])).exitCode, providerDown.changeCalls.planChange], [3, 0]);
});

test("plan-change report carries no customer identifiers or credentials", async () => {
  const text = formatRecoveryReport(await harness().run(["plan-change", "--change", ID]));
  assert.doesNotMatch(text, /77-secret-customer|test-key|Bearer/);
});

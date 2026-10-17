import assert from "node:assert/strict";
import test from "node:test";
import { formatBillingDate, getSubscriptionStatusPresentation } from "./billingSubscriptionPresentation.ts";
import type { BillingOverview } from "../types/billingOverview.ts";
import type { SalonEntitlements } from "../types/entitlements.ts";

type Entitlements = Pick<SalonEntitlements, "accessSource" | "accessReason" | "rawSubscriptionStatus" | "currentPeriodEndsAt">;
const base: Entitlements = { accessSource: "subscription", accessReason: "active_period", rawSubscriptionStatus: "active", currentPeriodEndsAt: "2026-12-15T10:00:00Z" };
const open: Pick<BillingOverview, "canOpenCustomerPortal" | "portalUnavailableReason" | "billingEnvironment"> = { canOpenCustomerPortal: true, portalUnavailableReason: null, billingEnvironment: "live" };
const closed = (reason: BillingOverview["portalUnavailableReason"]) => ({ ...open, canOpenCustomerPortal: false, portalUnavailableReason: reason });
const text = (value: unknown) => JSON.stringify(value);

test("active shows renewal only when the date exists and is valid", () => {
  const withDate = getSubscriptionStatusPresentation(base, open);
  assert.ok(withDate.lines.some((line) => line.startsWith("Sledeća obnova: ")));
  assert.match(withDate.lines.join(" "), /2026/);
  for (const currentPeriodEndsAt of [null, "", "not-a-date"]) {
    const result = getSubscriptionStatusPresentation({ ...base, currentPeriodEndsAt }, open);
    assert.deepEqual(result.lines, ["Pretplata je aktivna."]);
  }
});

test("cancelled before period end states the access end date; no resume promise", () => {
  const cancelled = { ...base, rawSubscriptionStatus: "cancelled" as const, accessReason: "cancelled_until_period_end" as const };
  const result = getSubscriptionStatusPresentation(cancelled, open);
  assert.match(result.lines[0], /^Pretplata je otkazana\. Pristup imate do .*2026\.$/);
  assert.doesNotMatch(text(result), /nastavi|otkaži|pauz/i);
  assert.equal(getSubscriptionStatusPresentation({ ...cancelled, currentPeriodEndsAt: "garbage" }, open).lines.length, 0);
});

test("cancelled after end and expired are read-only with no invented dates or renewal", () => {
  const ended = getSubscriptionStatusPresentation({ ...base, rawSubscriptionStatus: "cancelled", accessReason: "cancelled", currentPeriodEndsAt: null }, closed("not_applicable"));
  assert.deepEqual(ended.lines, ["Pretplata je otkazana i pristup je istekao."]);
  const expired = getSubscriptionStatusPresentation({ ...base, rawSubscriptionStatus: "expired", accessReason: "expired", currentPeriodEndsAt: null }, closed("not_applicable"));
  assert.match(expired.lines[0], /istekla/);
  assert.deepEqual(expired.portal, { kind: "hidden" });
  assert.doesNotMatch(text(expired), /obnov|nastavi|ponovo aktiv/i);
});

test("past_due explains read-only access and offers a payment-method path without promising access", () => {
  const result = getSubscriptionStatusPresentation({ ...base, rawSubscriptionStatus: "past_due", accessReason: "past_due" }, open);
  assert.match(result.lines[0], /naplata nije uspela.*samo za pregled/);
  assert.equal(result.portal.kind, "action");
  if (result.portal.kind === "action") {
    assert.equal(result.portal.cta, "Ažuriraj način plaćanja");
    assert.match(result.portal.description, /potvrda od providera/);
    assert.doesNotMatch(result.portal.description, /vraćen|biće|odmah|uspešn/i);
  }
});

test("override access never claims paid-subscription facts and gives no recovery promise", () => {
  const pilot = { ...base, accessSource: "billing_override" as const, accessReason: "billing_override" as const, rawSubscriptionStatus: null, currentPeriodEndsAt: null };
  assert.deepEqual(getSubscriptionStatusPresentation(pilot, closed("not_applicable")), { lines: [], portal: { kind: "hidden" } });
  const linked = getSubscriptionStatusPresentation({ ...pilot, rawSubscriptionStatus: "past_due" }, open);
  // billing state and effective access are shown separately; read-only is never claimed for override access
  assert.equal(linked.lines.length, 1);
  assert.match(linked.lines[0], /naplata pretplate nije uspela.*posebno odobrenje/);
  assert.doesNotMatch(text(linked), /samo za pregled|režimu pregleda/);
  assert.ok(linked.portal.kind === "action" && linked.portal.cta === "Ažuriraj način plaćanja");
  assert.match(text(linked.portal), /ne menja pristup koji trenutno određuje posebno odobrenje/);
  assert.deepEqual(getSubscriptionStatusPresentation({ ...pilot, rawSubscriptionStatus: "active" }, open).lines, []);
});

test("trial and provider-free subscriptions get no portal CTA and no payment lines", () => {
  const trial = getSubscriptionStatusPresentation({ ...base, rawSubscriptionStatus: "trialing", accessReason: "active_trial" }, closed("not_applicable"));
  assert.deepEqual(trial, { lines: [], portal: { kind: "hidden" } });
});

test("owner sees an action; non-owner only a note; disabled/invalid environment is an honest unavailability", () => {
  assert.equal(getSubscriptionStatusPresentation(base, open).portal.kind, "action");
  const manager = getSubscriptionStatusPresentation(base, closed("not_owner"));
  assert.deepEqual(manager.portal, { kind: "note", message: "Pretplatom i načinom plaćanja upravlja vlasnik salona." });
  const unavailable = getSubscriptionStatusPresentation({ ...base, rawSubscriptionStatus: "past_due", accessReason: "past_due" }, closed("unavailable"));
  assert.equal(unavailable.portal.kind, "note");
  assert.match(text(unavailable.portal), /trenutno nije dostupno/);
  assert.doesNotMatch(text(unavailable), /flag|BILLING_|parity|RPC|key|store/i);
});

test("overview unavailable (loading/error) shows lines from entitlements but no portal", () => {
  const result = getSubscriptionStatusPresentation({ ...base, rawSubscriptionStatus: "past_due", accessReason: "past_due" }, null);
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.portal, { kind: "hidden" });
});

test("test environment portal is labelled and makes no per-action promise", () => {
  const result = getSubscriptionStatusPresentation(base, { ...open, billingEnvironment: "test" });
  assert.ok(result.portal.kind === "action" && /^Test okruženje/.test(result.portal.description));
  assert.doesNotMatch(text(result.portal), /otkaz|nastav|pauz|promen/i);
  assert.doesNotMatch(text(getSubscriptionStatusPresentation(base, open).portal), /test/i);
});

test("formatBillingDate rejects missing and invalid input", () => {
  assert.equal(formatBillingDate(null), null);
  assert.equal(formatBillingDate(undefined), null);
  assert.equal(formatBillingDate(""), null);
  assert.equal(formatBillingDate("31.02.nope"), null);
  assert.match(formatBillingDate("2026-12-15T10:00:00Z") ?? "", /2026$/, "no trailing period; callers add punctuation");
});

test("unverifiable period (canonical invalid_period) explains the restriction without internals", () => {
  const result = getSubscriptionStatusPresentation({ ...base, accessReason: "invalid_period", currentPeriodEndsAt: "not-a-date" }, open);
  assert.equal(result.lines.length, 1);
  assert.match(result.lines[0], /ne možemo da potvrdimo važenje pretplate.*ograničen na pregled.*Proverite status/);
  assert.doesNotMatch(text(result), /invalid|period_|NaN|not-a-date/i);
  assert.equal(result.portal.kind, "action", "portal eligibility is unchanged");
  assert.equal(getSubscriptionStatusPresentation({ ...base, accessReason: "invalid_period" }, closed("unavailable")).portal.kind, "note");
});

test("the unverifiable-period message never appears for legitimate full-access states", () => {
  const message = /ne možemo da potvrdimo/;
  const legit: Entitlements[] = [
    base,
    { ...base, accessReason: "legacy_active_no_period", currentPeriodEndsAt: null },
    { ...base, accessReason: "cancelled_until_period_end", rawSubscriptionStatus: "cancelled" },
    { ...base, accessSource: "billing_override", accessReason: "billing_override", rawSubscriptionStatus: "active", currentPeriodEndsAt: "garbage" },
    { ...base, accessSource: "billing_override", accessReason: "billing_override", rawSubscriptionStatus: null, currentPeriodEndsAt: null },
    { ...base, accessReason: "active_trial", rawSubscriptionStatus: "trialing", currentPeriodEndsAt: null },
  ];
  for (const entitlements of legit) assert.doesNotMatch(text(getSubscriptionStatusPresentation(entitlements, open)), message);
});

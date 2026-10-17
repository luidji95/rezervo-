import assert from "node:assert/strict";
import test from "node:test";
import { getBillingPaymentPresentation } from "./billingPaymentPresentation.ts";
import type { BillingOverview } from "../types/billingOverview.ts";

const overview: BillingOverview = { billingEnvironment: "live", canOpenCustomerPortal: true, portalUnavailableReason: null, canStartCheckout: false, plans: [], usage: { activeEmployees: 3 } };

test("live recovery portal stays visible with checkout disabled and has no test or plan-switch promise", () => {
  const result = getBillingPaymentPresentation(overview, false);
  assert.equal(result.portalAvailable, true);
  assert.doesNotMatch(JSON.stringify(result), /test|pauz|promen.{0,5}paket|još nije uvedeno/i);
});

test("test portal is clearly identified even when checkout is disabled", () => {
  const result = getBillingPaymentPresentation({ ...overview, billingEnvironment: "test" }, false);
  assert.equal(result.portalAvailable, true);
  assert.match(result.summary, /test okruženje/);
});

test("loading/error and disabled/parity-rejected overview never promise a portal", () => {
  for (const candidate of [null, { ...overview, canOpenCustomerPortal: false, portalUnavailableReason: "unavailable" as const }]) {
    const result = getBillingPaymentPresentation(candidate, true);
    assert.equal(result.portalAvailable, false);
    assert.match(result.summary, /nisu dostupne/);
  }
});

test("shared checkout copy uses authoritative environment only when checkout is available", () => {
  for (const billingEnvironment of ["test", "live"] as const) {
    const result = getBillingPaymentPresentation({ ...overview, billingEnvironment, canOpenCustomerPortal: false, portalUnavailableReason: "unavailable", canStartCheckout: true }, true);
    assert.equal(result.portalAvailable, false);
    assert.equal(result.title.includes("test"), billingEnvironment === "test");
    assert.doesNotMatch(result.summary, /nisu dostupne/);
  }
});

test("unresolved trusted environment never claims test or live availability", () => {
  const result = getBillingPaymentPresentation({ ...overview, billingEnvironment: null, canOpenCustomerPortal: false, portalUnavailableReason: "unavailable", canStartCheckout: false }, true);
  assert.equal(result.portalAvailable, false);
  assert.doesNotMatch(`${result.title} ${result.summary} ${result.notice}`, /test/i);
  assert.match(result.summary, /nisu dostupne/);
});

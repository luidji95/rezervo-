import assert from "node:assert/strict";
import test from "node:test";

import { formatPlanPrice, getTrialPlanPriceMessage, normalizePlanCatalog, parsePlanPrice } from "./planCatalog.ts";

test("RSD formatter handles string and number numeric values", () => {
  assert.equal(formatPlanPrice("2990", "RSD"), "2.990 RSD");
  assert.equal(formatPlanPrice(5990, "RSD"), "5.990 RSD");
  assert.equal(parsePlanPrice("17990.00"), 17990);
});

test("null yearly price stays absent and is never calculated", () => {
  assert.equal(formatPlanPrice(null, "RSD"), null);
  const catalog = normalizePlanCatalog([{ slug: "pro", name: "Pro", monthly_price: "5990", yearly_price: null, currency: "RSD", max_employees: 10, is_active: true }]);
  assert.equal(catalog[0].yearlyPrice, null);
});

test("catalog exposes Premium as unavailable without removing it", () => {
  const catalog = normalizePlanCatalog([{ slug: "premium", name: "Premium", monthly_price: 17990, yearly_price: null, currency: "RSD", max_employees: 25, is_active: false }]);
  assert.equal(catalog[0].isAvailable, false);
  assert.equal(catalog[0].monthlyPrice, 17990);
});

test("trial billing copy uses canonical Pro price and does not imply payment", () => {
  const [pro] = normalizePlanCatalog([{ slug: "pro", name: "Pro", monthly_price: "5990", yearly_price: null, currency: "RSD", max_employees: 10, is_active: true }]);
  assert.equal(getTrialPlanPriceMessage(pro), "Cena nakon probnog perioda: 5.990 RSD mesečno. Kartica nije dodata.");
});

import assert from "node:assert/strict";
import test from "node:test";
import { getAcquisitionPlanMessage, getPricingCtaHref, parseAcquisitionPlan, resolveSafePostLoginPath, sanitizeNextPath } from "./acquisitionRouting.ts";

test("anonymous Starter and Pro CTAs start registration while Premium has no route", () => {
  for (const plan of ["starter","pro"] as const) assert.match(getPricingCtaHref({authenticated:false,salonState:"missing",plan}) ?? "", /^\/auth\/register\?/);
  assert.equal(getPricingCtaHref({authenticated:false,salonState:"missing",plan:"premium"}), null);
});
test("authenticated acquisition routing respects authoritative salon state", () => {
  assert.equal(getPricingCtaHref({authenticated:true,salonState:"missing",plan:"starter"}),"/onboarding");
  assert.equal(getPricingCtaHref({authenticated:true,salonState:"incomplete",plan:"pro"}),"/onboarding");
  assert.equal(getPricingCtaHref({authenticated:true,salonState:"complete",plan:"pro"}),"/settings?tab=billing");
  assert.equal(getPricingCtaHref({authenticated:true,salonState:"complete",plan:"starter",readOnly:true}),"/settings?tab=billing");
  assert.equal(getPricingCtaHref({authenticated:true,salonState:"loading",plan:"pro"}), null);
});
test("redirect allowlist rejects open redirects and unsafe schemes", () => {
  for (const value of ["https://evil.example","//evil.example","javascript:alert(1)","/unknown","/%2F%2Fevil.example","%2F%2Fevil.example","/\\evil.example","\\\\evil.example","/settings%3Ftab%3Dunknown"]) assert.equal(sanitizeNextPath(value),null);
  assert.equal(sanitizeNextPath("/settings?tab=billing"),"/settings?tab=billing");
  assert.equal(resolveSafePostLoginPath("/dashboard","/settings?tab=billing"),"/settings?tab=billing");
  assert.equal(resolveSafePostLoginPath("/onboarding","/dashboard"),"/onboarding");
});

test("presentation plan accepts only Starter and Pro", () => {
  assert.equal(parseAcquisitionPlan("starter"), "starter");
  assert.equal(parseAcquisitionPlan("pro"), "pro");
  for (const value of ["premium", "enterprise", "", null]) assert.equal(parseAcquisitionPlan(value), null);
  assert.equal(getAcquisitionPlanMessage("starter"), "Nakon probnog perioda možete nastaviti na Starter paketu.");
  assert.equal(getAcquisitionPlanMessage("pro"), "Nakon probnog perioda možete nastaviti na Pro paketu.");
  assert.equal(getAcquisitionPlanMessage(parseAcquisitionPlan("premium")), null);
});

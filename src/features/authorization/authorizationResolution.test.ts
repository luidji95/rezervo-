import assert from "node:assert/strict";
import test from "node:test";
import { getAppRouteRedirect, resolveAuthorizationState } from "./authorizationResolution.ts";

const base = { loading: false, error: null, userExists: true, salonExists: true, onboardingCompleted: true, role: "owner" as const };

test("unresolved authorization never redirects", () => {
  const resolution = resolveAuthorizationState({ ...base, loading: true, salonExists: false });
  assert.equal(resolution, "loading");
  assert.equal(getAppRouteRedirect({ resolution, hasRouteAccess: false }), null);
});

test("confirmed missing and incomplete salons redirect to onboarding", () => {
  const missing = resolveAuthorizationState({ ...base, salonExists: false });
  const incomplete = resolveAuthorizationState({ ...base, onboardingCompleted: false });
  assert.equal(getAppRouteRedirect({ resolution: missing, hasRouteAccess: true }), "/onboarding");
  assert.equal(getAppRouteRedirect({ resolution: incomplete, hasRouteAccess: true }), "/onboarding");
});

test("completed onboarding permits the app without an opposite redirect", () => {
  const ready = resolveAuthorizationState(base);
  assert.equal(ready, "loaded_with_completed_onboarding");
  assert.equal(getAppRouteRedirect({ resolution: ready, hasRouteAccess: true }), null);
});

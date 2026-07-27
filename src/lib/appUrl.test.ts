import assert from "node:assert/strict";
import test from "node:test";

import { getAppUrl } from "./appUrl.ts";

test("app URL prefers explicit configuration and removes a trailing slash", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://rezervo-app-gamma.vercel.app/";
  assert.equal(getAppUrl(), "https://rezervo-app-gamma.vercel.app");
  if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previous;
});

test("app URL uses the production Vercel alias and a local development fallback", () => {
  const previousPublic = process.env.NEXT_PUBLIC_APP_URL;
  const previousVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "rezervo-app-gamma.vercel.app";
  assert.equal(getAppUrl(), "https://rezervo-app-gamma.vercel.app");
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  assert.equal(getAppUrl(), "http://localhost:3000");
  if (previousPublic !== undefined) process.env.NEXT_PUBLIC_APP_URL = previousPublic;
  if (previousVercel !== undefined) process.env.VERCEL_PROJECT_PRODUCTION_URL = previousVercel;
});

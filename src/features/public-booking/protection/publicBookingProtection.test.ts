import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeClientIpBucket, readTrustedClientIp, TEST_CLIENT_IP_HEADER } from "./clientIp.ts";
import { enforcePublicBookingProtectionCore, type ProtectionDependencies, type PublicBookingProtectionConfig } from "./publicBookingProtectionCore.ts";
import { verifyTurnstileToken, type TurnstileConfig } from "./turnstileVerify.ts";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

test("IP buckets: IPv4 as is, IPv4-mapped IPv6 as IPv4, IPv6 by /64 in any notation", () => {
  assert.equal(normalizeClientIpBucket("203.0.113.7"), "v4:203.0.113.7");
  assert.equal(normalizeClientIpBucket("::ffff:203.0.113.7"), "v4:203.0.113.7");
  assert.equal(normalizeClientIpBucket("::FFFF:cb00:7107"), "v4:203.0.113.7");
  const a = normalizeClientIpBucket("2001:db8:1:2::1");
  for (const same of ["2001:0db8:0001:0002:0000:0000:0000:abcd", "[2001:db8:1:2::5]", "2001:DB8:1:2:ffff:ffff:ffff:ffff", "fe80::1%eth0".replace("fe80::1", "2001:db8:1:2::9")]) {
    assert.equal(normalizeClientIpBucket(same), a, same);
  }
  assert.equal(a, "v6:2001:db8:1:2::/64");
  assert.notEqual(normalizeClientIpBucket("2001:db8:1:3::1"), a);
  assert.equal(normalizeClientIpBucket("::1"), "v6:0:0:0:0::/64");
  for (const bad of ["", "abc", "999.1.1.1", "1.2.3", "1.2.3.4.5", "2001:db8::1::2", "12345::1", "01.2.3.4"]) assert.equal(normalizeClientIpBucket(bad), null, bad);
});

test("client IP source: on Vercel only x-vercel-forwarded-for; elsewhere nothing unless the local test header is enabled", () => {
  const spoofed = { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7", [TEST_CLIENT_IP_HEADER]: "8.8.8.8", "cf-connecting-ip": "9.9.9.9" };
  assert.equal(readTrustedClientIp(headers({ ...spoofed, "x-vercel-forwarded-for": "198.51.100.4" }), { onVercel: true, trustTestHeader: true }), "198.51.100.4");
  assert.equal(readTrustedClientIp(headers({ ...spoofed, "x-vercel-forwarded-for": "198.51.100.4, 10.0.0.1" }), { onVercel: true, trustTestHeader: false }), "198.51.100.4");
  assert.equal(readTrustedClientIp(headers(spoofed), { onVercel: true, trustTestHeader: true }), null, "on Vercel no other header is used");
  assert.equal(readTrustedClientIp(headers({ ...spoofed, "x-vercel-forwarded-for": "198.51.100.4" }), { onVercel: false, trustTestHeader: false }), null, "off Vercel nothing is trusted");
  assert.equal(readTrustedClientIp(headers(spoofed), { onVercel: false, trustTestHeader: true }), "8.8.8.8", "local tests: only the explicit test header");
});

const turnstileConfig: TurnstileConfig = { secret: "s", verifyUrl: "https://verify.test/siteverify", allowedHostnames: new Set(["rezervo.test"]), expectedAction: "public_booking", timeoutMs: 50 };
function fakeFetch(answers: (Response | "timeout" | "network")[]) {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    const next = answers.shift() ?? "network";
    if (next === "network") throw new TypeError("fetch failed");
    if (next === "timeout") return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const input = { token: "tok", verificationId: "11111111-1111-4111-8111-111111111111", remoteIp: "203.0.113.7" };

test("siteverify: success requires the allowed hostname and the expected action", async () => {
  const ok = fakeFetch([json({ success: true, hostname: "rezervo.test", action: "public_booking" })]);
  assert.deepEqual(await verifyTurnstileToken(input, turnstileConfig, ok.fetchImpl), { ok: true });
  assert.deepEqual(ok.calls[0], { secret: "s", response: "tok", remoteip: "203.0.113.7", idempotency_key: input.verificationId });
  assert.equal((await verifyTurnstileToken(input, turnstileConfig, fakeFetch([json({ success: true, hostname: "evil.test", action: "public_booking" })]).fetchImpl) as { reason: string }).reason, "hostname");
  assert.equal((await verifyTurnstileToken(input, turnstileConfig, fakeFetch([json({ success: true, hostname: "rezervo.test", action: "login" })]).fetchImpl) as { reason: string }).reason, "action");
  assert.equal((await verifyTurnstileToken(input, turnstileConfig, fakeFetch([json({ success: true, hostname: "rezervo.test" })]).fetchImpl) as { reason: string }).reason, "action");
});

test("siteverify: expired/duplicate and invalid tokens are visitor errors; configuration errors fail closed", async () => {
  assert.equal((await verifyTurnstileToken(input, turnstileConfig, fakeFetch([json({ success: false, "error-codes": ["timeout-or-duplicate"] })]).fetchImpl) as { reason: string }).reason, "expired_or_duplicate");
  assert.equal((await verifyTurnstileToken(input, turnstileConfig, fakeFetch([json({ success: false, "error-codes": ["invalid-input-response"] })]).fetchImpl) as { reason: string }).reason, "rejected");
  assert.equal((await verifyTurnstileToken(input, turnstileConfig, fakeFetch([json({ success: false, "error-codes": ["invalid-input-secret"] })]).fetchImpl) as { reason: string }).reason, "unavailable");
});

test("siteverify: one repeat with the same verification id on timeout, network error, 5xx or internal-error; then unavailable", async () => {
  for (const first of ["timeout", "network", json({}, 502), json({ success: false, "error-codes": ["internal-error"] })] as const) {
    const retry = fakeFetch([first, json({ success: true, hostname: "rezervo.test", action: "public_booking" })]);
    assert.deepEqual(await verifyTurnstileToken(input, turnstileConfig, retry.fetchImpl), { ok: true });
    assert.equal(retry.calls.length, 2);
    assert.equal(retry.calls[0].idempotency_key, retry.calls[1].idempotency_key);
  }
  const down = fakeFetch(["timeout", "timeout"]);
  assert.equal((await verifyTurnstileToken(input, turnstileConfig, down.fetchImpl) as { reason: string }).reason, "unavailable");
  assert.equal(down.calls.length, 2);
});

const baseConfig: PublicBookingProtectionConfig = {
  enabled: true, onVercel: false, trustTestIpHeader: true, siteKey: "site", turnstileSecret: "secret", verifyUrl: "https://verify.test",
  allowedHostnames: new Set(["rezervo.test"]), rateLimitHashKey: "k".repeat(40),
};
function deps(overrides: Partial<ProtectionDependencies> = {}) {
  const calls = { limit: 0, verify: 0 };
  const dependencies: ProtectionDependencies = {
    config: baseConfig,
    hmac: (_key, value) => `h:${value}`,
    hitRateLimit: async () => { calls.limit += 1; return { allowed: true, retryAfterSeconds: 0, reason: null }; },
    verify: async () => { calls.verify += 1; return { ok: true }; },
    ...overrides,
  };
  return { calls, dependencies };
}
const request = { headers: headers({ [TEST_CLIENT_IP_HEADER]: "203.0.113.7" }), botCheck: { token: "tok", verificationId: "22222222-2222-4222-8222-222222222222" } };

test("protection: off by default, fail closed when enabled without configuration, IP or services", async () => {
  const off = deps({ config: { ...baseConfig, enabled: false } });
  assert.deepEqual(await enforcePublicBookingProtectionCore({ headers: headers({}), botCheck: undefined }, off.dependencies), { ok: true });
  assert.equal(off.calls.limit + off.calls.verify, 0);
  for (const missing of [{ siteKey: null }, { turnstileSecret: null }, { allowedHostnames: new Set<string>() }, { rateLimitHashKey: null }, { rateLimitHashKey: "short" }]) {
    const d = deps({ config: { ...baseConfig, ...missing } });
    const decision = await enforcePublicBookingProtectionCore(request, d.dependencies);
    assert.equal(decision.ok ? 200 : decision.status, 503, JSON.stringify(missing));
    assert.equal(d.calls.limit + d.calls.verify, 0);
  }
  const noIp = deps({ config: { ...baseConfig, trustTestIpHeader: false } });
  assert.equal(((await enforcePublicBookingProtectionCore(request, noIp.dependencies)) as { status: number }).status, 503);
  const dbDown = deps({ hitRateLimit: async () => { throw new Error("db"); } });
  assert.equal(((await enforcePublicBookingProtectionCore(request, dbDown.dependencies)) as { status: number }).status, 503);
  assert.equal(dbDown.calls.verify, 0);
  const cfDown = deps({ verify: async () => ({ ok: false, reason: "unavailable", detail: "SITEVERIFY_UNAVAILABLE" }) });
  assert.equal(((await enforcePublicBookingProtectionCore(request, cfDown.dependencies)) as { status: number }).status, 503);
});

test("protection: missing or malformed token is refused before the limit; limit before Cloudflare", async () => {
  for (const botCheck of [undefined, { token: "", verificationId: request.botCheck.verificationId }, { token: "tok", verificationId: "not-a-uuid" }, { token: "x".repeat(2049), verificationId: request.botCheck.verificationId }]) {
    const d = deps();
    const decision = await enforcePublicBookingProtectionCore({ headers: request.headers, botCheck }, d.dependencies);
    assert.equal((decision as { status: number }).status, 403);
    assert.equal(d.calls.limit, 0);
  }
  const limited = deps({ hitRateLimit: async () => ({ allowed: false, retryAfterSeconds: 120, reason: "per_10_minutes" }) });
  assert.deepEqual(await enforcePublicBookingProtectionCore(request, limited.dependencies), { ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 120, logCode: "RATE_LIMITED_PER_10_MINUTES" });
  assert.equal(limited.calls.verify, 0);
  let bucket = "";
  const ok = deps({ hitRateLimit: async (key) => { bucket = key; return { allowed: true, retryAfterSeconds: 0, reason: null }; } });
  assert.deepEqual(await enforcePublicBookingProtectionCore(request, ok.dependencies), { ok: true });
  assert.equal(bucket, "h:v4:203.0.113.7");
  for (const reason of ["rejected", "expired_or_duplicate", "hostname", "action"] as const) {
    const d = deps({ verify: async () => ({ ok: false, reason, detail: reason }) });
    assert.equal(((await enforcePublicBookingProtectionCore(request, d.dependencies)) as { status: number }).status, 403, reason);
  }
});

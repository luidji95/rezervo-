import { normalizeClientIpBucket, readTrustedClientIp, type HeaderReader } from "./clientIp.ts";
import { PUBLIC_BOOKING_TURNSTILE_ACTION, type TurnstileResult } from "./turnstileVerify.ts";

// Protection of new public bookings: bot check (Turnstile, validated on the server) and a per-IP limit shared by all
// instances. Runs after the idempotent replay check, so a retry for an already created booking never reaches it.
// When enabled, anything missing or unreachable refuses the new booking (fail closed); it never silently lets it pass.

export type PublicBookingProtectionConfig = {
  enabled: boolean;
  onVercel: boolean;
  trustTestIpHeader: boolean;
  siteKey: string | null;
  turnstileSecret: string | null;
  verifyUrl: string;
  allowedHostnames: ReadonlySet<string>;
  rateLimitHashKey: string | null;
};

export type BotCheckInput = { token: string; verificationId: string } | undefined;

export type ProtectionDecision =
  | { ok: true }
  | { ok: false; status: 403; code: "BOT_CHECK_FAILED"; logCode: string }
  | { ok: false; status: 429; code: "RATE_LIMITED"; retryAfterSeconds: number; logCode: string }
  | { ok: false; status: 503; code: "PROTECTION_UNAVAILABLE"; logCode: string };

export type ProtectionDependencies = {
  config: PublicBookingProtectionConfig;
  hmac(key: string, value: string): string;
  hitRateLimit(keyHash: string): Promise<{ allowed: boolean; retryAfterSeconds: number; reason: string | null }>;
  verify(input: { token: string; verificationId: string; remoteIp: string }): Promise<TurnstileResult>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProtectionConfigured(config: PublicBookingProtectionConfig) {
  return Boolean(config.siteKey && config.turnstileSecret && config.allowedHostnames.size > 0 && config.rateLimitHashKey && config.rateLimitHashKey.length >= 32);
}

const unavailable = (logCode: string): ProtectionDecision => ({ ok: false, status: 503, code: "PROTECTION_UNAVAILABLE", logCode });
const botFailed = (logCode: string): ProtectionDecision => ({ ok: false, status: 403, code: "BOT_CHECK_FAILED", logCode });

export async function enforcePublicBookingProtectionCore(
  input: { headers: HeaderReader; botCheck: BotCheckInput },
  dependencies: ProtectionDependencies,
): Promise<ProtectionDecision> {
  const { config } = dependencies;
  if (!config.enabled) return { ok: true };
  if (!isProtectionConfigured(config)) return unavailable("PROTECTION_MISCONFIGURED");

  // A request without a usable token is refused before it costs a database or Cloudflare call.
  const botCheck = input.botCheck;
  if (!botCheck || !botCheck.token || botCheck.token.length > 2048 || !UUID.test(botCheck.verificationId)) return botFailed("BOT_CHECK_MISSING");

  const ip = readTrustedClientIp(input.headers, { onVercel: config.onVercel, trustTestHeader: config.trustTestIpHeader });
  const bucket = ip ? normalizeClientIpBucket(ip) : null;
  if (!ip || !bucket) return unavailable("CLIENT_IP_UNAVAILABLE");

  let limit: Awaited<ReturnType<ProtectionDependencies["hitRateLimit"]>>;
  try {
    limit = await dependencies.hitRateLimit(dependencies.hmac(config.rateLimitHashKey as string, bucket));
  } catch {
    return unavailable("RATE_LIMIT_UNAVAILABLE");
  }
  if (!limit.allowed) {
    return { ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: Math.max(1, limit.retryAfterSeconds), logCode: `RATE_LIMITED_${(limit.reason ?? "unknown").toUpperCase()}` };
  }

  let verified: TurnstileResult;
  try {
    verified = await dependencies.verify({ token: botCheck.token, verificationId: botCheck.verificationId, remoteIp: ip });
  } catch {
    return unavailable("BOT_CHECK_UNAVAILABLE");
  }
  if (verified.ok) return { ok: true };
  return verified.reason === "unavailable" ? unavailable(verified.detail) : botFailed(verified.detail);
}

export function buildTurnstileConfig(config: PublicBookingProtectionConfig) {
  return {
    secret: config.turnstileSecret as string,
    verifyUrl: config.verifyUrl,
    allowedHostnames: config.allowedHostnames,
    expectedAction: PUBLIC_BOOKING_TURNSTILE_ACTION,
  };
}

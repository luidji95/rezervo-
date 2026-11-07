import "server-only";
import { createHmac } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import type { HeaderReader } from "./clientIp";
import {
  buildTurnstileConfig,
  enforcePublicBookingProtectionCore,
  type BotCheckInput,
  type PublicBookingProtectionConfig,
} from "./publicBookingProtectionCore";
import { TURNSTILE_VERIFY_URL, verifyTurnstileToken } from "./turnstileVerify";

const isProduction = process.env.NODE_ENV === "production";

// Off unless PUBLIC_BOOKING_PROTECTION_ENABLED=true. When on, every value below is required (see isProtectionConfigured).
export function getPublicBookingProtectionConfig(): PublicBookingProtectionConfig {
  const onVercel = process.env.VERCEL === "1";
  return {
    enabled: process.env.PUBLIC_BOOKING_PROTECTION_ENABLED === "true",
    onVercel,
    // Local tests only: never on Vercel and never in a production build.
    trustTestIpHeader: !onVercel && !isProduction && process.env.PUBLIC_BOOKING_TRUST_TEST_IP_HEADER === "true",
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null,
    turnstileSecret: process.env.TURNSTILE_SECRET_KEY?.trim() || null,
    // A local fake siteverify server can be used only outside production builds.
    verifyUrl: !isProduction && process.env.TURNSTILE_VERIFY_URL?.trim() ? process.env.TURNSTILE_VERIFY_URL.trim() : TURNSTILE_VERIFY_URL,
    allowedHostnames: new Set((process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)),
    rateLimitHashKey: process.env.PUBLIC_BOOKING_RATE_LIMIT_HASH_KEY?.trim() || null,
  };
}

// Site key for the public page, or null when the widget must not be shown (protection off).
export function getPublicBookingBotCheckSiteKey() {
  const config = getPublicBookingProtectionConfig();
  return config.enabled ? config.siteKey : null;
}

export async function enforcePublicBookingProtection(headers: HeaderReader, botCheck: BotCheckInput) {
  const config = getPublicBookingProtectionConfig();
  const decision = await enforcePublicBookingProtectionCore({ headers, botCheck }, {
    config,
    hmac: (key, value) => createHmac("sha256", key).update(value, "utf8").digest("hex"),
    hitRateLimit: async (keyHash) => {
      const { data, error } = await supabaseServer.rpc("hit_public_booking_rate_limit_v1", { p_key_hash: keyHash });
      const row = (data as { allowed: boolean; retry_after_seconds: number; reason: string | null }[] | null)?.[0];
      if (error || !row || typeof row.allowed !== "boolean") throw new Error("RATE_LIMIT_RPC_FAILED");
      return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds, reason: row.reason };
    },
    verify: (input) => verifyTurnstileToken(input, buildTurnstileConfig(config)),
  });
  // Outcome codes only: never the token, IP address or its digest.
  if (!decision.ok) console.warn("PUBLIC_BOOKING_PROTECTION_REFUSED", { code: decision.code, reason: decision.logCode });
  return decision;
}

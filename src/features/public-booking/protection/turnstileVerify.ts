// Server-side Cloudflare Turnstile validation (siteverify). A token is valid for 300 s and can be validated once.
// The same verification id (Cloudflare `idempotency_key`) is used only when the same token is validated again; the
// client creates a new id for every new token.
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const PUBLIC_BOOKING_TURNSTILE_ACTION = "public_booking";

export type TurnstileConfig = {
  secret: string;
  verifyUrl: string;
  allowedHostnames: ReadonlySet<string>;
  expectedAction: string;
  timeoutMs?: number;
};

export type TurnstileInput = { token: string; verificationId: string; remoteIp: string };

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "rejected" | "expired_or_duplicate" | "hostname" | "action" | "unavailable"; detail: string };

type SiteverifyResponse = { success?: unknown; "error-codes"?: unknown; hostname?: unknown; action?: unknown };

// Errors that say our own configuration is wrong: fail closed as unavailable, never as a visitor error.
const CONFIGURATION_ERRORS = new Set(["missing-input-secret", "invalid-input-secret"]);

export async function verifyTurnstileToken(
  input: TurnstileInput,
  config: TurnstileConfig,
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<TurnstileResult> {
  const attempt = async (): Promise<SiteverifyResponse | "retry"> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 4000);
    try {
      const response = await fetchImplementation(config.verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ secret: config.secret, response: input.token, remoteip: input.remoteIp, idempotency_key: input.verificationId }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.status >= 500) return "retry";
      const body = await response.json().catch(() => null) as SiteverifyResponse | null;
      if (!body || typeof body.success !== "boolean") return "retry";
      const codes = Array.isArray(body["error-codes"]) ? body["error-codes"] : [];
      if (!body.success && codes.includes("internal-error")) return "retry";
      return body;
    } catch {
      return "retry";
    } finally {
      clearTimeout(timeout);
    }
  };

  // One repeat of the same validation (same token, same verification id) for transient failures only.
  let body = await attempt();
  if (body === "retry") body = await attempt();
  if (body === "retry") return { ok: false, reason: "unavailable", detail: "SITEVERIFY_UNAVAILABLE" };

  const codes = (Array.isArray(body["error-codes"]) ? body["error-codes"] : []).filter((code): code is string => typeof code === "string");
  if (body.success !== true) {
    if (codes.some((code) => CONFIGURATION_ERRORS.has(code))) return { ok: false, reason: "unavailable", detail: "SITEVERIFY_CONFIGURATION" };
    if (codes.includes("timeout-or-duplicate")) return { ok: false, reason: "expired_or_duplicate", detail: "TIMEOUT_OR_DUPLICATE" };
    return { ok: false, reason: "rejected", detail: codes.length ? "TOKEN_REJECTED" : "TOKEN_REJECTED_NO_CODE" };
  }
  if (typeof body.hostname !== "string" || !config.allowedHostnames.has(body.hostname.toLowerCase())) {
    return { ok: false, reason: "hostname", detail: "HOSTNAME_NOT_ALLOWED" };
  }
  if (body.action !== config.expectedAction) return { ok: false, reason: "action", detail: "ACTION_MISMATCH" };
  return { ok: true };
}

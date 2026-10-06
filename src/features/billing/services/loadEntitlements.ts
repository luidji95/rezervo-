import type { SalonEntitlements } from "../types/entitlements.ts";

export function classifyEntitlementLoadFailure(error: unknown): "illegal_invocation" | "invalid_headers" | "network_failure" | "unknown" {
  if (!(error instanceof TypeError)) return "unknown";
  if (/illegal invocation/i.test(error.message)) return "illegal_invocation";
  if (/bytestring|iso-8859-1/i.test(error.message) ||
      (/\bheaders?\b/i.test(error.message) && /invalid|character|not valid/i.test(error.message))) return "invalid_headers";
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error.message)) return "network_failure";
  return "unknown";
}

export async function loadEntitlements(input: {
  salonId: string;
  getAccessToken: () => Promise<string | null>;
  request: typeof fetch;
}): Promise<{ entitlements: SalonEntitlements | null; error: string | null }> {
  try {
    console.info("ENTITLEMENTS_LOAD", { stage: "token_read" });
    const token = await input.getAccessToken();
    console.info("ENTITLEMENTS_LOAD", { stage: "token_ready", hasToken: Boolean(token) });
    if (!token) throw new Error("UNAUTHORIZED");
    console.info("ENTITLEMENTS_LOAD", { stage: "fetch_started" });
    const response = await input.request(`/api/entitlements?salonId=${encodeURIComponent(input.salonId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    console.info("ENTITLEMENTS_LOAD", { stage: "fetch_finished", ok: response.ok });
    const body = await response.json() as { success: boolean; entitlements?: SalonEntitlements; code?: string };
    if (!response.ok || !body.success || !body.entitlements) throw new Error(body.code ?? "ENTITLEMENTS_LOAD_FAILED");
    return { entitlements: body.entitlements, error: null };
  } catch (error) {
    console.info("ENTITLEMENTS_LOAD", { stage: "failed", category: classifyEntitlementLoadFailure(error) });
    return { entitlements: null, error: error instanceof Error ? error.message : "ENTITLEMENTS_LOAD_FAILED" };
  }
}

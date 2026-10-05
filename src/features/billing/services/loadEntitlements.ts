import type { SalonEntitlements } from "../types/entitlements.ts";

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
    console.info("ENTITLEMENTS_LOAD", { stage: "failed" });
    return { entitlements: null, error: error instanceof Error ? error.message : "ENTITLEMENTS_LOAD_FAILED" };
  }
}

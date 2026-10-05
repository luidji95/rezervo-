import type { SalonEntitlements } from "../types/entitlements.ts";

export async function loadEntitlements(input: {
  salonId: string;
  getAccessToken: () => Promise<string | null>;
  request: typeof fetch;
}): Promise<{ entitlements: SalonEntitlements | null; error: string | null }> {
  try {
    const token = await input.getAccessToken();
    if (!token) throw new Error("UNAUTHORIZED");
    const response = await input.request(`/api/entitlements?salonId=${encodeURIComponent(input.salonId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const body = await response.json() as { success: boolean; entitlements?: SalonEntitlements; code?: string };
    if (!response.ok || !body.success || !body.entitlements) throw new Error(body.code ?? "ENTITLEMENTS_LOAD_FAILED");
    return { entitlements: body.entitlements, error: null };
  } catch (error) {
    return { entitlements: null, error: error instanceof Error ? error.message : "ENTITLEMENTS_LOAD_FAILED" };
  }
}

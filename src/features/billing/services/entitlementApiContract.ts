import type { SalonEntitlements } from "../types/entitlements";

export function buildEntitlementApiSuccess(entitlements: SalonEntitlements) {
  return { success: true as const, entitlements };
}

export function getEntitlementApiErrorStatus(code: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "SALON_REQUIRED") return 400;
  if (code === "FORBIDDEN") return 403;
  return 500;
}

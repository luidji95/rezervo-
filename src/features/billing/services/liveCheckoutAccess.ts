import type { BillingEnvironment } from "../config/billingEnvironment.ts";

/**
 * Who may start a live checkout. `allowlist` (the default) keeps the mandatory pilot list;
 * `public` must be set explicitly. Any other value is invalid and keeps live checkout closed.
 */
export type LiveCheckoutAccessMode = "allowlist" | "public";

export function parseLiveCheckoutAccessMode(raw: string | undefined): LiveCheckoutAccessMode | null {
  const value = (raw ?? "").trim();
  if (value === "" || value === "allowlist") return "allowlist";
  return value === "public" ? "public" : null;
}

export type LiveCheckoutAccess = {
  environment: BillingEnvironment;
  /** Omitted or null means `allowlist`. */
  liveCheckoutAccessMode?: LiveCheckoutAccessMode | null;
  liveAllowedSalonIds: ReadonlySet<string> | null;
};

/** Single gate shared by the checkout route and the billing overview. Test checkout is not gated here. */
export function isLiveCheckoutSalonAllowed(access: LiveCheckoutAccess, salonId: string) {
  if (access.environment !== "live") return true;
  if (access.liveCheckoutAccessMode === "public") return true;
  return access.liveAllowedSalonIds?.has(salonId) === true;
}

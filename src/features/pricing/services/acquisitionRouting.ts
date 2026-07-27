import type { AcquisitionPlan, PublicPlan } from "../types";

export const SAFE_NEXT_PATHS = ["/onboarding", "/dashboard", "/settings", "/settings?tab=billing"] as const;

export function sanitizeNextPath(value: string | null | undefined): string | null {
  if (!value || value.includes("\\") || value.startsWith("//") || !value.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.startsWith("//") || !decoded.startsWith("/")) return null;
  return (SAFE_NEXT_PATHS as readonly string[]).includes(decoded) ? decoded : null;
}

export function parseAcquisitionPlan(value: string | null | undefined): AcquisitionPlan | null {
  return value === "starter" || value === "pro" ? value : null;
}

export function getAcquisitionPlanMessage(plan: AcquisitionPlan | null): string | null {
  if (!plan) return null;
  return `Nakon probnog perioda možete nastaviti na ${plan === "starter" ? "Starter" : "Pro"} paketu.`;
}

export function getPricingCtaHref(input: {
  authenticated: boolean;
  salonState: "loading" | "missing" | "incomplete" | "complete";
  plan: PublicPlan["code"];
  readOnly?: boolean;
}): string | null {
  if (input.plan === "premium") return null;
  if (!input.authenticated) {
    const params = new URLSearchParams({ next: "/onboarding", source: "pricing", plan: input.plan });
    return `/auth/register?${params}`;
  }
  if (input.salonState === "loading") return null;
  if (input.salonState === "missing" || input.salonState === "incomplete") return "/onboarding";
  if (input.salonState === "complete" || input.readOnly) return "/settings?tab=billing";
  return "/dashboard";
}

export function resolveSafePostLoginPath(defaultPath: string, requestedNext: string | null | undefined): string {
  const safe = sanitizeNextPath(requestedNext);
  if (defaultPath === "/onboarding") return "/onboarding";
  return safe === "/onboarding" ? defaultPath : safe ?? defaultPath;
}

import type { AuthorizationRole } from "./types.ts";

export type AuthorizationResolution =
  | "loading"
  | "unauthenticated"
  | "loaded_without_salon"
  | "loaded_with_incomplete_onboarding"
  | "loaded_with_completed_onboarding"
  | "error";

export function resolveAuthorizationState(input: {
  loading: boolean;
  error: string | null;
  userExists: boolean;
  salonExists: boolean;
  onboardingCompleted: boolean;
  role: AuthorizationRole | null;
}): AuthorizationResolution {
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (!input.userExists) return "unauthenticated";
  if (!input.salonExists) return "loaded_without_salon";
  if (input.role === "owner" && !input.onboardingCompleted) {
    return "loaded_with_incomplete_onboarding";
  }
  return "loaded_with_completed_onboarding";
}

export function getAppRouteRedirect(input: {
  resolution: AuthorizationResolution;
  hasRouteAccess: boolean;
}) {
  if (input.resolution === "unauthenticated") return "/auth/login";
  if (
    input.resolution === "loaded_without_salon" ||
    input.resolution === "loaded_with_incomplete_onboarding"
  ) return "/onboarding";
  if (input.resolution === "loaded_with_completed_onboarding" && !input.hasRouteAccess) {
    return "/dashboard";
  }
  return null;
}

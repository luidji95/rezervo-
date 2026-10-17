import type { BillingEnvironment } from "../config/billingEnvironment.ts";
import type { BillingCustomerPortalConfig } from "./billingCustomerPortalConfig.ts";
import { canOpenCustomerPortal, isPortalEligibleSubscription, type PortalSubscription } from "./billingCustomerPortalCore.ts";

export interface PortalEnvironmentClient {
  rpc(name: "billing_environment_matches_v1", args: { p_environment: BillingEnvironment }): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function billingPortalEnvironmentMatches(client: PortalEnvironmentClient, environment: BillingEnvironment) {
  try {
    const { data, error } = await client.rpc("billing_environment_matches_v1", { p_environment: environment });
    return error === null && data === true;
  } catch {
    return false;
  }
}

export type PortalRuntimeDependencies = {
  getConfig(): BillingCustomerPortalConfig;
  environmentMatches(environment: BillingEnvironment): Promise<boolean>;
};

export async function resolveBillingPortalRuntime(dependencies: PortalRuntimeDependencies) {
  try {
    const config = dependencies.getConfig();
    return await dependencies.environmentMatches(config.environment) === true ? config : null;
  } catch {
    return null;
  }
}

/**
 * Coarse, user-safe reason the portal cannot be opened. It deliberately hides whether the cause is
 * the feature flag, configuration, environment or parity check.
 */
export type PortalUnavailableReason = "not_owner" | "not_applicable" | "unavailable";

export async function resolveBillingPortalAvailabilityDetail(
  input: { isOwner: boolean; subscription: Partial<PortalSubscription> | null },
  dependencies: PortalRuntimeDependencies,
): Promise<{ available: true; reason: null } | { available: false; reason: PortalUnavailableReason }> {
  if (!input.isOwner) return { available: false, reason: "not_owner" };
  if (!isPortalEligibleSubscription(input.subscription)) return { available: false, reason: "not_applicable" };
  const config = await resolveBillingPortalRuntime(dependencies);
  const available = Boolean(config && canOpenCustomerPortal({ ...input, configured: true, environment: config.environment, databaseEnvironmentMatches: true }));
  return available ? { available: true, reason: null } : { available: false, reason: "unavailable" };
}

export async function resolveBillingPortalAvailability(
  input: { isOwner: boolean; subscription: Partial<PortalSubscription> | null },
  dependencies: PortalRuntimeDependencies,
) {
  return (await resolveBillingPortalAvailabilityDetail(input, dependencies)).available;
}

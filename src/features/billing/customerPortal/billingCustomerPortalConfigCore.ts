import { resolveLemonSqueezyProviderConfig } from "../config/lemonSqueezyProviderConfigCore.ts";

export type PortalEnvironment = Record<string, string | undefined>;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parsePortalAllowedHosts(value: string | undefined) {
  const hosts = (value ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (hosts.length === 0 || hosts.some((host) => host.includes("*") || !HOST_PATTERN.test(host))) return null;
  return new Set(hosts);
}

export function isBillingCustomerPortalConfigured(env: PortalEnvironment) {
  return resolveBillingCustomerPortalConfig(env) !== null;
}

export function resolveBillingCustomerPortalConfig(env: PortalEnvironment) {
  let providerConfig;
  try {
    providerConfig = resolveLemonSqueezyProviderConfig(env, "test");
  } catch {
    return null;
  }
  const allowedHosts = parsePortalAllowedHosts(
    env.LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS,
  );
  if (env.BILLING_CUSTOMER_PORTAL_ENABLED !== "true" || !allowedHosts) {
    return null;
  }
  return { ...providerConfig, allowedHosts };
}

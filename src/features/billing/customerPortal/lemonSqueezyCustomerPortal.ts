import type { BillingCustomerPortalProvider, BillingCustomerPortalInput } from "./billingCustomerPortalCore.ts";
import { BillingCustomerPortalError } from "./billingCustomerPortalErrors.ts";

const API_BASE = "https://api.lemonsqueezy.com/v1/subscriptions/";
const JSON_API = "application/vnd.api+json";

function normalizedId(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function validateCustomerPortalUrl(value: unknown, allowedHosts: ReadonlySet<string>) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !url.pathname) return null;
    if (!allowedHosts.has(url.hostname.toLowerCase())) return null;
    return value;
  } catch {
    return null;
  }
}

export function getRedactedPortalUrlShape(value: string) {
  const url = new URL(value);
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    pathname: url.pathname,
    hasQuery: url.search.length > 0,
    hasFragment: url.hash.length > 0,
  };
}

export class LemonSqueezyCustomerPortalProvider implements BillingCustomerPortalProvider {
  private readonly config: { apiKey: string; storeId: string; allowedHosts: ReadonlySet<string> };
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    config: { apiKey: string; storeId: string; allowedHosts: ReadonlySet<string> },
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 10_000,
  ) { this.config = config; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }

  async createCustomerPortal(input: BillingCustomerPortalInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${API_BASE}${encodeURIComponent(input.providerSubscriptionId)}`, {
        method: "GET",
        headers: { Accept: JSON_API, "Content-Type": JSON_API, Authorization: `Bearer ${this.config.apiKey}` },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 429) throw new BillingCustomerPortalError("BILLING_PORTAL_RATE_LIMITED", 429);
      if (!response.ok) throw new BillingCustomerPortalError("BILLING_PORTAL_PROVIDER_UNAVAILABLE", 502);
      const payload = await response.json() as { data?: { type?: unknown; id?: unknown; attributes?: Record<string, unknown> } };
      const attributes = payload.data?.attributes;
      const urls = attributes?.urls as { customer_portal?: unknown } | undefined;
      const url = validateCustomerPortalUrl(urls?.customer_portal, this.config.allowedHosts);
      if (payload.data?.type !== "subscriptions"
        || normalizedId(payload.data.id) !== input.providerSubscriptionId
        || normalizedId(attributes?.customer_id) !== input.providerCustomerId
        || normalizedId(attributes?.store_id) !== this.config.storeId
        || attributes?.test_mode !== true
        || !url) {
        throw new BillingCustomerPortalError("BILLING_PORTAL_PROVIDER_UNAVAILABLE", 502);
      }
      return { url };
    } catch (error) {
      if (error instanceof BillingCustomerPortalError) throw error;
      throw new BillingCustomerPortalError("BILLING_PORTAL_PROVIDER_UNAVAILABLE", 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}

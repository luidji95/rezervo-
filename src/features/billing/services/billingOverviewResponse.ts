import type { BillingOverview } from "../types/billingOverview.ts";
import { parsePlanChangeOverview } from "./billingPlanChangePresentation.ts";

const REASONS = ["not_owner", "not_applicable", "unavailable"];

/** Validates the overview API body; returns null for anything that is not a complete canonical response. */
export function parseBillingOverviewBody(body: unknown): BillingOverview | null {
  const value = body as Partial<BillingOverview> & { success?: boolean } | null;
  if (!value || value.success !== true || !value.usage || !value.plans) return null;
  if (typeof value.canOpenCustomerPortal !== "boolean" || typeof value.canStartCheckout !== "boolean") return null;
  if (!(value.billingEnvironment === null || value.billingEnvironment === "test" || value.billingEnvironment === "live")) return null;
  const reason = value.portalUnavailableReason;
  if (value.canOpenCustomerPortal ? reason !== null : typeof reason !== "string" || !REASONS.includes(reason)) return null;
  return {
    usage: value.usage,
    plans: value.plans,
    canOpenCustomerPortal: value.canOpenCustomerPortal,
    portalUnavailableReason: reason ?? null,
    canStartCheckout: value.canStartCheckout,
    billingEnvironment: value.billingEnvironment,
    planChange: parsePlanChangeOverview((value as { planChange?: unknown }).planChange),
  };
}

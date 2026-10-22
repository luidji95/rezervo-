import type { PlanChangeOverview } from "./planChange.ts";

export type BillingUsage = {
  activeEmployees: number;
};

export type BillingPlanCatalogItem = {
  code: "starter" | "pro" | "premium";
  name: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  currency: string;
  maxEmployees: number | null;
  isAvailable: boolean;
};

export type BillingOverview = {
  billingEnvironment: "test" | "live" | null;
  usage: BillingUsage;
  plans: BillingPlanCatalogItem[];
  canOpenCustomerPortal: boolean;
  /** Coarse reason when the portal is unavailable; null when it is available. */
  portalUnavailableReason: "not_owner" | "not_applicable" | "unavailable" | null;
  canStartCheckout: boolean;
  /** C2 plan-change availability and the latest relevant change (sanitized). */
  planChange: PlanChangeOverview;
};

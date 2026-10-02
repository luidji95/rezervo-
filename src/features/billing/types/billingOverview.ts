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
  usage: BillingUsage;
  plans: BillingPlanCatalogItem[];
  canOpenCustomerPortal: boolean;
};

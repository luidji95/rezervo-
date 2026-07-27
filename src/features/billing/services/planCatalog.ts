import type { BillingPlanCatalogItem } from "../types/billingOverview";

export type PlanCatalogRow = {
  slug: string;
  name: string;
  monthly_price: string | number;
  yearly_price: string | number | null;
  currency: string;
  max_employees: number | null;
  is_active: boolean;
};

export function parsePlanPrice(value: string | number | null): number | null {
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizePlanCatalog(rows: PlanCatalogRow[]): BillingPlanCatalogItem[] {
  return rows.flatMap((row) => {
    if (!(["starter", "pro", "premium"] as const).includes(row.slug as "starter" | "pro" | "premium")) return [];
    const monthlyPrice = parsePlanPrice(row.monthly_price);
    if (monthlyPrice === null) return [];
    return [{
      code: row.slug as BillingPlanCatalogItem["code"],
      name: row.name,
      monthlyPrice,
      yearlyPrice: parsePlanPrice(row.yearly_price),
      currency: row.currency,
      maxEmployees: row.max_employees,
      isAvailable: row.is_active,
    }];
  });
}

export function formatPlanPrice(value: string | number | null, currency: string): string | null {
  const parsed = parsePlanPrice(value);
  if (parsed === null) return null;
  if (currency === "RSD") {
    return `${new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 0 }).format(parsed)} RSD`;
  }
  return `${new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 }).format(parsed)} ${currency}`;
}

export function getTrialPlanPriceMessage(plan: BillingPlanCatalogItem): string {
  return `Cena Pro paketa nakon probnog perioda: ${formatPlanPrice(plan.monthlyPrice, plan.currency)} mesečno. Kartica nije dodata, a checkout još nije dostupan.`;
}

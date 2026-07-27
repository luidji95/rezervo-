import type { PublicPlan } from "../types";
import { parsePlanPrice } from "../../billing/services/planCatalog.ts";

type Row = Record<string, unknown>;
const codes = ["starter", "pro", "premium"] as const;
const canonical = {
  starter: { name: "Starter", monthlyPrice: 2990, maxEmployees: 3, isAvailable: true, capabilities: [false, false, false, false, false, false] },
  pro: { name: "Pro", monthlyPrice: 5990, maxEmployees: 10, isAvailable: true, capabilities: [true, true, false, false, false, false] },
  premium: { name: "Premium", monthlyPrice: 17990, maxEmployees: 25, isAvailable: false, capabilities: [true, true, true, true, true, true] },
} as const;

export function normalizePublicPlanCatalog(rows: Row[]): PublicPlan[] {
  const plans = rows.flatMap((row): PublicPlan[] => {
    if (!codes.includes(row.slug as typeof codes[number])) return [];
    const monthlyPrice = parsePlanPrice(row.monthly_price as string | number | null);
    const code = row.slug as PublicPlan["code"];
    const expected = canonical[code];
    const yearlyPrice = parsePlanPrice(row.yearly_price as string | number | null);
    const capabilities = [row.analytics_enabled, row.sms_reminders_enabled, row.ai_receptionist_enabled, row.whatsapp_enabled, row.instagram_enabled, row.marketing_enabled];
    if (
      monthlyPrice === null ||
      monthlyPrice !== expected.monthlyPrice ||
      yearlyPrice !== null ||
      row.currency !== "RSD" ||
      row.max_employees !== expected.maxEmployees ||
      row.is_active !== expected.isAvailable ||
      row.name !== expected.name ||
      capabilities.some((value, index) => value !== expected.capabilities[index])
    ) return [];
    return [{
      code, name: expected.name, monthlyPrice,
      yearlyPrice,
      currency: "RSD", maxEmployees: expected.maxEmployees,
      isAvailable: row.is_active === true,
      capabilities: {
        analytics: row.analytics_enabled === true, smsReminders: row.sms_reminders_enabled === true,
        aiReceptionist: row.ai_receptionist_enabled === true, whatsapp: row.whatsapp_enabled === true,
        instagram: row.instagram_enabled === true, marketing: row.marketing_enabled === true,
      },
    }];
  });
  if (rows.length !== 3 || plans.length !== 3 || codes.some((code) => plans.filter((plan) => plan.code === code).length !== 1)) {
    throw new Error("PUBLIC_PLAN_CATALOG_INCOMPLETE");
  }
  return plans;
}

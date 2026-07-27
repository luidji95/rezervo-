import type { PlanCode } from "@/features/billing/types/entitlements";

export type PublicPlan = {
  code: PlanCode;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  currency: string;
  maxEmployees: number | null;
  isAvailable: boolean;
  capabilities: {
    analytics: boolean;
    smsReminders: boolean;
    aiReceptionist: boolean;
    whatsapp: boolean;
    instagram: boolean;
    marketing: boolean;
  };
};

export type AcquisitionPlan = "starter" | "pro";

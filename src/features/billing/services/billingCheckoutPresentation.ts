import type {
  PlanCode,
  SubscriptionAccessReason,
} from "../types/entitlements.ts";

export type CheckoutButtonPresentation = {
  disabled: boolean;
  label: string;
  checkoutPlan: "starter" | "pro" | null;
};

type CheckoutPresentationInput = {
  planCode: PlanCode;
  currentPlanCode: PlanCode | null;
  accessReason: SubscriptionAccessReason;
  isBillingExempt: boolean;
  checkoutEnabled: boolean;
  loadingPlan: "starter" | "pro" | null;
};

const PAID_ACCESS_REASONS = new Set<SubscriptionAccessReason>([
  "active_period",
  "legacy_active_no_period",
  "cancelled_until_period_end",
]);

function planLabel(planCode: "starter" | "pro") {
  return planCode === "starter" ? "Starter" : "Pro";
}

export function getCheckoutButtonPresentation({
  planCode,
  currentPlanCode,
  accessReason,
  isBillingExempt,
  checkoutEnabled,
  loadingPlan,
}: CheckoutPresentationInput): CheckoutButtonPresentation {
  if (planCode === "premium") {
    return {
      disabled: true,
      label: "Premium je u pripremi",
      checkoutPlan: null,
    };
  }

  if (!checkoutEnabled) {
    return {
      disabled: true,
      label:
        planCode === currentPlanCode
          ? "Trenutni paket"
          : "Online nadogradnja uskoro",
      checkoutPlan: null,
    };
  }

  if (isBillingExempt) {
    return {
      disabled: true,
      label: "Checkout nije dostupan",
      checkoutPlan: null,
    };
  }

  if (loadingPlan) {
    return {
      disabled: true,
      label:
        loadingPlan === planCode
          ? "Otvaranje checkouta…"
          : `Izaberi ${planLabel(planCode)}`,
      checkoutPlan: null,
    };
  }

  if (PAID_ACCESS_REASONS.has(accessReason)) {
    return {
      disabled: true,
      label:
        planCode === currentPlanCode
          ? "Trenutni paket"
          : "Promena paketa uskoro",
      checkoutPlan: null,
    };
  }

  return {
    disabled: false,
    label:
      accessReason === "active_trial" && planCode === "pro"
        ? "Aktiviraj Pro"
        : `Izaberi ${planLabel(planCode)}`,
    checkoutPlan: planCode,
  };
}

import type { SalonEntitlements } from "../types/entitlements.ts";

type View = Pick<SalonEntitlements, "planCapabilities" | "employeeCapacity" | "purchaseActivation">;

const PLAN_NAMES = { starter: "Starter", pro: "Pro", premium: "Premium" } as const;

/** Limit shown for new activations: the database effective limit, else the plan limit (display fallback only). */
export function getEffectiveEmployeeLimit(entitlements: View | null): number | null {
  if (!entitlements) return null;
  return entitlements.employeeCapacity
    ? entitlements.employeeCapacity.maxEmployees
    : entitlements.planCapabilities.maxEmployees;
}

export function getPendingCheckoutNotice(entitlements: View | null): string | null {
  const capacity = entitlements?.employeeCapacity;
  if (!capacity || capacity.reason !== "pending_checkout" || capacity.maxEmployees === null) return null;
  const plan = capacity.pendingPlanCode ? PLAN_NAMES[capacity.pendingPlanCode] : "izabrani";
  return `Započeta kupovina paketa ${plan} ograničava broj aktivnih zaposlenih na ${capacity.maxEmployees} dok se kupovina ne završi.`;
}

/** Never claims a payment unless the database recorded a paid initial invoice for that subscription. */
export function getPurchaseActivationNotice(entitlements: View | null): string | null {
  const activation = entitlements?.purchaseActivation;
  if (!activation) return null;
  const parts = [
    ...(activation.paymentConfirmed ? ["Plaćanje je primljeno."] : []),
    "Kupovina čeka aktivaciju. Nemojte pokretati novu kupovinu.",
  ];
  if (activation.reason === "capacity" && activation.targetMaxEmployees !== null) {
    parts.push(`Smanjite broj aktivnih zaposlenih na najviše ${activation.targetMaxEmployees}, a zatim se obratite podršci da završi aktivaciju.`);
  } else if (activation.reason === "review") {
    parts.push("Obratite se podršci da proveri i završi aktivaciju.");
  }
  return parts.join(" ");
}

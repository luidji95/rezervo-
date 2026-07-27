import type { SalonEntitlements } from "../types/entitlements";

const OVERRIDE_LABELS = {
  internal: "Interni nalog",
  pilot: "Pilot pristup",
  complimentary: "Besplatan pristup",
  support: "Support pristup",
} as const;

export function getBillingAccessPresentation(entitlements: SalonEntitlements) {
  if (entitlements.accessSource === "billing_override" && entitlements.overrideType) {
    return {
      statusLabel: OVERRIDE_LABELS[entitlements.overrideType],
      statusTone: "active",
      paymentMessage: "Naplata nije potrebna.",
      accessEndsAt: entitlements.overrideEndsAt,
      billingActionsEnabled: false,
    };
  }
  return {
    statusLabel: null,
    statusTone: null,
    paymentMessage: null,
    accessEndsAt: null,
    billingActionsEnabled: false,
  };
}

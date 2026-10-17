import type { BillingOverview } from "../types/billingOverview.ts";

export function getBillingPaymentPresentation(overview: BillingOverview | null, checkoutEnabled: boolean) {
  const portalAvailable = overview?.canOpenCustomerPortal === true;
  const checkoutAvailable = checkoutEnabled && overview?.canStartCheckout === true;
  const available = portalAvailable || checkoutAvailable;
  const test = available && overview?.billingEnvironment === "test";
  return {
    portalAvailable,
    title: available ? (test ? "Lemon Squeezy test okruženje" : "Plaćanje preko Lemon Squeezy") : "Upravljanje plaćanjem",
    summary: available
      ? (test ? "Dostupne akcije koriste Lemon Squeezy test okruženje." : "Dostupne akcije za plaćanje prikazane su iznad.")
      : "Online akcije za ovu pretplatu trenutno nisu dostupne. Za pomoć kontaktirajte podršku.",
    notice: available
      ? "Stanje pretplate se ažurira nakon potvrđenih događaja. Povratak sa stranice za plaćanje nije potvrda promene."
      : "Podaci o pretplati ostaju dostupni za pregled.",
  };
}

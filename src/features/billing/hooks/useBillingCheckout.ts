"use client";

import { useCallback, useRef, useState } from "react";

import { useAuthorization } from "@/context/AuthorizationContext";
import { supabase } from "@/lib/supabase/client";

type CheckoutPlanCode = "starter" | "pro";

const FALLBACK_ERROR =
  "Checkout trenutno nije moguće pokrenuti. Pokušajte ponovo.";

const ERROR_MESSAGES: Record<string, string> = {
  NO_SESSION: "Prijavljena sesija nije dostupna. Prijavite se ponovo.",
  NO_ACTIVE_SALON: "Aktivni salon nije dostupan. Osvežite stranicu i pokušajte ponovo.",
  FORBIDDEN: "Nemate dozvolu da pokrenete checkout za ovaj salon.",
  BILLING_OWNER_REQUIRED: "Samo vlasnik salona može da pokrene checkout.",
  BILLING_CHECKOUT_DISABLED: "Test checkout trenutno nije uključen.",
  BILLING_NOT_CONFIGURED: "Test checkout trenutno nije konfigurisan.",
  BILLING_PRICE_MAPPING_NOT_FOUND: "Cena izabranog paketa trenutno nije dostupna.",
  BILLING_PRICE_MAPPING_MISSING: "Cena izabranog paketa trenutno nije dostupna.",
  BILLING_PLAN_NOT_AVAILABLE: "Izabrani paket trenutno nije dostupan.",
  BILLING_PRICE_MISMATCH: "Cena paketa trenutno nije usklađena. Pokušajte kasnije.",
  BILLING_CHECKOUT_IN_PROGRESS: "Checkout za ovaj paket se već priprema.",
  BILLING_PROVIDER_UNAVAILABLE: "Servis za checkout trenutno nije dostupan. Pokušajte ponovo.",
  BILLING_PROVIDER_REJECTED: "Checkout zahtev je odbijen. Proverite paket i pokušajte ponovo.",
  BILLING_RECONCILIATION_REQUIRED: "Checkout se još proverava. Nemojte ponavljati zahtev odmah.",
  BILLING_OVERRIDE_ACTIVE: "Checkout nije dostupan za salon sa posebnim billing pristupom.",
  INVALID_INPUT: FALLBACK_ERROR,
};

function errorMessage(code: unknown) {
  return typeof code === "string" ? (ERROR_MESSAGES[code] ?? FALLBACK_ERROR) : FALLBACK_ERROR;
}

function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function useBillingCheckout() {
  const { currentSalon } = useAuthorization();
  const [loadingPlan, setLoadingPlan] = useState<CheckoutPlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  const startCheckout = useCallback(
    async (planCode: CheckoutPlanCode) => {
      if (requestInFlight.current) return;
      setError(null);

      if (!currentSalon) {
        setError(errorMessage("NO_ACTIVE_SALON"));
        return;
      }

      requestInFlight.current = true;
      setLoadingPlan(planCode);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          setError(errorMessage("NO_SESSION"));
          return;
        }

        const response = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            salonId: currentSalon.id,
            planCode,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          success?: boolean;
          code?: string;
          checkout?: { checkoutUrl?: unknown };
        } | null;

        if (!response.ok || body?.success !== true) {
          setError(errorMessage(body?.code));
          return;
        }
        if (!validCheckoutUrl(body.checkout?.checkoutUrl)) {
          setError(FALLBACK_ERROR);
          return;
        }

        window.location.assign(body.checkout.checkoutUrl);
      } catch {
        setError(FALLBACK_ERROR);
      } finally {
        requestInFlight.current = false;
        setLoadingPlan(null);
      }
    },
    [currentSalon],
  );

  return { startCheckout, loadingPlan, error };
}

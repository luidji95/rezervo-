"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const FALLBACK = "Portal za upravljanje pretplatom trenutno nije dostupan. Pokušajte ponovo.";
const MESSAGES: Record<string, string> = {
  BILLING_PORTAL_UNAUTHORIZED: "Prijavljena sesija nije dostupna. Prijavite se ponovo.",
  BILLING_PORTAL_FORBIDDEN: "Samo vlasnik salona može da upravlja pretplatom.",
  BILLING_PORTAL_SUBSCRIPTION_UNAVAILABLE: "Portal nije dostupan za trenutnu pretplatu.",
  BILLING_PORTAL_RATE_LIMITED: "Portal je privremeno zauzet. Pokušajte ponovo uskoro.",
  BILLING_PORTAL_PROVIDER_UNAVAILABLE: FALLBACK,
  BILLING_PORTAL_DISABLED: "Portal za upravljanje pretplatom trenutno nije uključen.",
  BILLING_PORTAL_INTERNAL_ERROR: FALLBACK,
};

export function useBillingCustomerPortal() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const openPortal = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError(MESSAGES.BILLING_PORTAL_UNAUTHORIZED); return; }
      const response = await fetch("/api/billing/customer-portal", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const body = await response.json().catch(() => null) as { success?: boolean; code?: string; portal?: { url?: unknown } } | null;
      if (!response.ok || body?.success !== true || typeof body.portal?.url !== "string" || !body.portal.url.trim()) {
        setError(typeof body?.code === "string" ? (MESSAGES[body.code] ?? FALLBACK) : FALLBACK);
        return;
      }
      window.location.assign(body.portal.url);
    } catch { setError(FALLBACK); }
    finally { inFlight.current = false; setLoading(false); }
  }, []);
  return { openPortal, loading, error };
}

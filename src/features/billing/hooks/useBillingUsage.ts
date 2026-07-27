"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthorization } from "@/context/AuthorizationContext";
import { supabase } from "@/lib/supabase/client";
import type { BillingOverview } from "../types/billingOverview";

export function useBillingUsage() {
  const { currentSalon } = useAuthorization();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    if (!currentSalon) { setOverview(null); setLoading(false); return; }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("UNAUTHORIZED");
      const response = await fetch(`/api/billing/overview?salonId=${encodeURIComponent(currentSalon.id)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const body = await response.json() as { success: boolean; usage?: BillingOverview["usage"]; plans?: BillingOverview["plans"] };
      if (!response.ok || !body.success || !body.usage || !body.plans) throw new Error("BILLING_OVERVIEW_LOAD_FAILED");
      setOverview({ usage: body.usage, plans: body.plans });
      setError(false);
    } catch {
      setOverview(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentSalon]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refetch(), 0);
    return () => window.clearTimeout(timeout);
  }, [refetch]);

  return { overview, usage: overview?.usage ?? null, plans: overview?.plans ?? null, loading, error, refetch };
}

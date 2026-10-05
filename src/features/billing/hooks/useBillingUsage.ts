"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { supabase } from "@/lib/supabase/client";
import type { BillingOverview } from "../types/billingOverview";

export function useBillingUsage() {
  const { currentSalon, loading: authorizationLoading } = useAuthorization();
  const { user } = useAuth();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const scope = user && currentSalon ? `${user.id}:${currentSalon.id}` : null;
  const requestId = useRef(0);
  const invalidateRequest = useCallback(() => { requestId.current++; }, []);

  const refetch = useCallback(async () => {
    const id = ++requestId.current;
    if (!currentSalon || !user) { setOverview(null); setLoadedScope(null); setError(null); setLoading(false); return; }
    setLoading(true);
    setOverview(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("UNAUTHORIZED");
      const response = await fetch(`/api/billing/overview?salonId=${encodeURIComponent(currentSalon.id)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const body = await response.json() as { success: boolean; code?: string; usage?: BillingOverview["usage"]; plans?: BillingOverview["plans"]; canOpenCustomerPortal?: boolean; canStartCheckout?: boolean };
      if (!response.ok || !body.success || !body.usage || !body.plans || typeof body.canOpenCustomerPortal !== "boolean" || typeof body.canStartCheckout !== "boolean") throw new Error(body.code ?? "BILLING_OVERVIEW_LOAD_FAILED");
      if (id !== requestId.current) return;
      setOverview({ usage: body.usage, plans: body.plans, canOpenCustomerPortal: body.canOpenCustomerPortal, canStartCheckout: body.canStartCheckout });
      setError(null);
    } catch (requestError) {
      if (id !== requestId.current) return;
      setOverview(null);
      setError(requestError instanceof Error ? requestError.message : "BILLING_OVERVIEW_LOAD_FAILED");
    } finally {
      if (id === requestId.current) { setLoadedScope(scope); setLoading(false); }
    }
  }, [currentSalon, user, scope]);

  useEffect(() => {
    if (authorizationLoading) return;
    const timeout = window.setTimeout(() => void refetch(), 0);
    return () => { window.clearTimeout(timeout); invalidateRequest(); };
  }, [refetch, authorizationLoading, invalidateRequest]);

  const pending = loading || authorizationLoading || loadedScope !== scope;
  const currentOverview = pending ? null : overview;
  return { overview: currentOverview, usage: currentOverview?.usage ?? null, plans: currentOverview?.plans ?? null, loading: pending, error: pending ? null : error, refetch };
}

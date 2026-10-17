"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { supabase } from "@/lib/supabase/client";
import type { BillingOverview } from "../types/billingOverview";
import { parseBillingOverviewBody } from "../services/billingOverviewResponse";

async function fetchOverview(salonId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("UNAUTHORIZED");
  const response = await fetch(`/api/billing/overview?salonId=${encodeURIComponent(salonId)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
  const body = await response.json() as { code?: string };
  const overview = response.ok ? parseBillingOverviewBody(body) : null;
  if (!overview) throw new Error(body.code ?? "BILLING_OVERVIEW_LOAD_FAILED");
  return overview;
}

export function useBillingUsage() {
  const { currentSalon, loading: authorizationLoading } = useAuthorization();
  const { user } = useAuth();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const scope = user && currentSalon ? `${user.id}:${currentSalon.id}` : null;
  const requestId = useRef(0);
  const refreshInFlight = useRef<Promise<BillingOverview | null> | null>(null);
  const invalidateRequest = useCallback(() => { requestId.current++; }, []);

  const refetch = useCallback(async () => {
    const id = ++requestId.current;
    if (!currentSalon || !user) { setOverview(null); setLoadedScope(null); setError(null); setLoading(false); return; }
    setLoading(true);
    setOverview(null);
    try {
      const next = await fetchOverview(currentSalon.id);
      if (id !== requestId.current) return;
      setOverview(next);
      setError(null);
    } catch (requestError) {
      if (id !== requestId.current) return;
      setOverview(null);
      setError(requestError instanceof Error ? requestError.message : "BILLING_OVERVIEW_LOAD_FAILED");
    } finally {
      if (id === requestId.current) { setLoadedScope(scope); setLoading(false); }
    }
  }, [currentSalon, user, scope]);

  /**
   * Soft re-read of the server overview. Keeps the last valid overview on failure and drops results
   * that were superseded by a scope change, a full reload or unmount. Resolves the fresh overview, or null when nothing fresh was read.
   */
  const refresh = useCallback((): Promise<BillingOverview | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    if (!currentSalon || !user || loading || loadedScope !== scope) return Promise.resolve(null);
    const id = requestId.current;
    const salonId = currentSalon.id;
    const run = (async () => {
      try {
        const next = await fetchOverview(salonId);
        if (id !== requestId.current) return null;
        setOverview(next);
        setError(null);
        return next;
      } catch {
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = run;
    return run;
  }, [currentSalon, user, loading, loadedScope, scope]);

  useEffect(() => {
    if (authorizationLoading) return;
    const timeout = window.setTimeout(() => void refetch(), 0);
    return () => { window.clearTimeout(timeout); invalidateRequest(); };
  }, [refetch, authorizationLoading, invalidateRequest]);

  const pending = loading || authorizationLoading || loadedScope !== scope;
  const currentOverview = pending ? null : overview;
  return { overview: currentOverview, usage: currentOverview?.usage ?? null, plans: currentOverview?.plans ?? null, loading: pending, error: pending ? null : error, refetch, refresh };
}

"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { supabase } from "@/lib/supabase/client";
import { EntitlementsContext } from "./hooks/useEntitlements";
import type { SalonEntitlements } from "./types/entitlements";

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { currentSalon, loading: authorizationLoading } = useAuthorization();
  const [entitlements, setEntitlements] = useState<SalonEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchEntitlements = useCallback(async () => {
    if (!user || !currentSalon) {
      setEntitlements(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("UNAUTHORIZED");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/entitlements?salonId=${encodeURIComponent(currentSalon.id)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const body = await response.json() as { success: boolean; entitlements?: SalonEntitlements; code?: string };
      if (!response.ok || !body.success || !body.entitlements) throw new Error(body.code ?? "ENTITLEMENTS_LOAD_FAILED");
      setEntitlements(body.entitlements);
      setError(null);
    } catch (requestError) {
      setEntitlements(null);
      setError(requestError instanceof Error ? requestError.message : "ENTITLEMENTS_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [currentSalon, user]);

  useEffect(() => {
    if (authorizationLoading) return;
    const timeout = window.setTimeout(() => void refetchEntitlements(), 0);
    return () => window.clearTimeout(timeout);
  }, [authorizationLoading, refetchEntitlements]);

  const value = useMemo(() => ({ entitlements, loading: authorizationLoading || loading, error, refetchEntitlements }), [authorizationLoading, entitlements, error, loading, refetchEntitlements]);
  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

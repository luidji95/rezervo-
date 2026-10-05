"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { supabase } from "@/lib/supabase/client";
import { EntitlementsContext } from "./hooks/useEntitlements";
import type { SalonEntitlements } from "./types/entitlements";
import { loadEntitlements } from "./services/loadEntitlements";

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { currentSalon, loading: authorizationLoading } = useAuthorization();
  const [entitlements, setEntitlements] = useState<SalonEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const requestId = useRef(0);
  const scope = user && currentSalon ? `${user.id}:${currentSalon.id}` : null;
  const invalidateRequest = useCallback(() => { requestId.current++; }, []);

  const refetchEntitlements = useCallback(async () => {
    const id = ++requestId.current;
    if (!user || !currentSalon) {
      setEntitlements(null);
      setLoadedScope(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setEntitlements(null);
    setError(null);
    const result = await loadEntitlements({
      salonId: currentSalon.id,
      getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      request: fetch,
    });
    if (id !== requestId.current) return;
    setEntitlements(result.entitlements);
    setError(result.error);
    setLoadedScope(scope);
    setLoading(false);
  }, [currentSalon, user, scope]);

  useEffect(() => {
    if (authorizationLoading) return;
    const timeout = window.setTimeout(() => void refetchEntitlements(), 0);
    return () => { window.clearTimeout(timeout); invalidateRequest(); };
  }, [authorizationLoading, refetchEntitlements, invalidateRequest]);

  const value = useMemo(() => ({
    entitlements: loadedScope === scope && !loading && !authorizationLoading ? entitlements : null,
    loading: authorizationLoading || loading || loadedScope !== scope,
    error: loadedScope === scope ? error : null,
    refetchEntitlements,
  }), [authorizationLoading, entitlements, error, loading, refetchEntitlements, loadedScope, scope]);
  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

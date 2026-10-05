"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { EntitlementsContext } from "./hooks/useEntitlements";
import type { SalonEntitlements } from "./types/entitlements";
import { loadEntitlements } from "./services/loadEntitlements";

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user, accessToken, loading: authLoading } = useAuth();
  const { currentSalon, loading: authorizationLoading } = useAuthorization();
  const [entitlements, setEntitlements] = useState<SalonEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const requestId = useRef(0);
  const userId = user?.id;
  const salonId = currentSalon?.id;
  const scope = userId && salonId ? `${userId}:${salonId}` : null;
  const invalidateRequest = useCallback(() => { requestId.current++; }, []);

  const refetchEntitlements = useCallback(async () => {
    console.info("ENTITLEMENTS_LOAD", { stage: "reload", authLoading, authorizationLoading, hasUser: Boolean(userId), hasSalon: Boolean(salonId), hasToken: Boolean(accessToken) });
    if (authLoading || authorizationLoading) return;
    const id = ++requestId.current;
    if (!userId || !salonId) {
      setEntitlements(null);
      setLoadedScope(null);
      setError("ENTITLEMENTS_CONTEXT_UNAVAILABLE");
      setLoading(false);
      return;
    }
    setLoading(true);
    setEntitlements(null);
    setError(null);
    const result = await loadEntitlements({
      salonId,
      getAccessToken: async () => accessToken,
      request: fetch,
    });
    if (id !== requestId.current) {
      console.info("ENTITLEMENTS_LOAD", { stage: "result_discarded", stale: true });
      return;
    }
    setEntitlements(result.entitlements);
    setError(result.error);
    setLoadedScope(scope);
    setLoading(false);
  }, [salonId, userId, scope, accessToken, authLoading, authorizationLoading]);

  useEffect(() => {
    if (authLoading || authorizationLoading) return;
    const timeout = window.setTimeout(() => void refetchEntitlements(), 0);
    return () => { window.clearTimeout(timeout); invalidateRequest(); };
  }, [authLoading, authorizationLoading, refetchEntitlements, invalidateRequest]);

  const value = useMemo(() => ({
    entitlements: loadedScope === scope && !loading && !authLoading && !authorizationLoading ? entitlements : null,
    loading: authLoading || authorizationLoading || loading || loadedScope !== scope,
    error: loadedScope === scope ? error : null,
    refetchEntitlements,
  }), [authLoading, authorizationLoading, entitlements, error, loading, refetchEntitlements, loadedScope, scope]);
  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

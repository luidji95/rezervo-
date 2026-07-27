"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/context/AuthContext";
import { loadAuthorizationSnapshot } from "@/features/authorization/services/authorizationService";
import type {
  AuthorizationSnapshot,
} from "@/features/authorization/types";
import { getPermissions } from "@/features/authorization/permissions";
import {
  resolveAuthorizationState,
  type AuthorizationResolution,
} from "@/features/authorization/authorizationResolution";

const EMPTY_AUTHORIZATION: AuthorizationSnapshot = {
  currentProfile: null,
  currentMembership: null,
  currentRole: null,
  currentSalon: null,
  currentEmployee: null,
  permissions: getPermissions(null),
  source: null,
};

type AuthorizationContextValue = AuthorizationSnapshot & {
  loading: boolean;
  resolution: AuthorizationResolution;
  error: string | null;
  refetchAuthorization: () => Promise<AuthorizationSnapshot>;
};

const AuthorizationContext = createContext<AuthorizationContextValue | null>(
  null,
);

export function AuthorizationProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [authorization, setAuthorization] =
    useState<AuthorizationSnapshot>(EMPTY_AUTHORIZATION);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetchAuthorization = useCallback(async () => {
    if (!user) {
      setAuthorization(EMPTY_AUTHORIZATION);
      setError(null);
      setResolvedUserId(null);
      return EMPTY_AUTHORIZATION;
    }

    setIsRefreshing(true);
    setError(null);

    try {
      const snapshot = await loadAuthorizationSnapshot(user.id);
      setAuthorization(snapshot);
      setResolvedUserId(user.id);
      return snapshot;
    } catch (authorizationError) {
      console.error("Failed to load authorization:", authorizationError);
      setAuthorization(EMPTY_AUTHORIZATION);
      setResolvedUserId(user.id);
      setError("Nije moguće učitati pristup salonu. Pokušajte ponovo.");
      throw authorizationError;
    } finally {
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;

    let ignore = false;

    if (!user) {
      Promise.resolve().then(() => {
        if (ignore) return;
        setAuthorization(EMPTY_AUTHORIZATION);
        setResolvedUserId(null);
        setError(null);
      });

      return () => {
        ignore = true;
      };
    }

    loadAuthorizationSnapshot(user.id)
      .then((snapshot) => {
        if (ignore) return;
        setAuthorization(snapshot);
        setResolvedUserId(user.id);
        setError(null);
      })
      .catch((authorizationError) => {
        if (ignore) return;
        console.error("Failed to load authorization:", authorizationError);
        setAuthorization(EMPTY_AUTHORIZATION);
        setResolvedUserId(user.id);
        setError("Nije moguće učitati pristup salonu. Pokušajte ponovo.");
      });

    return () => {
      ignore = true;
    };
  }, [authLoading, user]);

  const loading =
    authLoading || isRefreshing || Boolean(user && resolvedUserId !== user.id);
  const resolution = resolveAuthorizationState({
    loading,
    error,
    userExists: Boolean(user),
    salonExists: Boolean(authorization.currentSalon),
    onboardingCompleted: Boolean(authorization.currentSalon?.onboarding_completed),
    role: authorization.currentRole,
  });

  const value = useMemo(
    () => ({
      ...authorization,
      loading,
      resolution,
      error,
      refetchAuthorization,
    }),
    [authorization, error, loading, refetchAuthorization, resolution],
  );

  return (
    <AuthorizationContext.Provider value={value}>
      {children}
    </AuthorizationContext.Provider>
  );
}

export function useAuthorization() {
  const context = useContext(AuthorizationContext);

  if (!context) {
    throw new Error(
      "useAuthorization must be used within AuthorizationProvider.",
    );
  }

  return context;
}

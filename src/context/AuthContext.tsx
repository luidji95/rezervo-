"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";

type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    let authRevision = 0;

    async function loadUser() {
      const revision = authRevision;
      console.info("AUTH_STATE", { stage: "session_read" });
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (ignore || revision !== authRevision) return;

      console.info("AUTH_STATE", { stage: "session_ready", hasSession: Boolean(session), hasError: Boolean(sessionError) });

      setUser(session?.user ?? null);
      setAccessToken(session?.access_token ?? null);
      setLoading(false);

      // Network validation is only needed when local storage contains a session.
      // RLS and server endpoints remain the authorization boundary.
      if (!session) return;

      console.info("AUTH_STATE", { stage: "user_validation" });
      const {
        data: { user: verifiedUser },
        error: userError,
      } = await supabase.auth.getUser(session.access_token);
      if (ignore || revision !== authRevision) return;

      console.info("AUTH_STATE", { stage: "user_validated", hasUser: Boolean(verifiedUser), hasError: Boolean(userError) });

      if (!userError) setUser(verifiedUser);
    }

    void loadUser().catch(() => {
      if (ignore || authRevision !== 0) return;
      console.info("AUTH_STATE", { stage: "bootstrap_failed", hasUser: false, hasToken: false });
      setUser(null);
      setAccessToken(null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ignore) return;
      authRevision++;
      console.info("AUTH_STATE", { stage: "auth_change", hasUser: Boolean(session?.user), hasToken: Boolean(session?.access_token) });
      setUser(session?.user ?? null);
      setAccessToken(session?.access_token ?? null);
      setLoading(false);
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}

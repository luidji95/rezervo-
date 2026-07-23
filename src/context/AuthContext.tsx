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
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadUser() {
      const sessionStartedAt = performance.now();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (ignore) return;

      if (process.env.NODE_ENV === "development") {
        console.info("AUTH_BOOTSTRAP_SESSION", {
          durationMs: Math.round(performance.now() - sessionStartedAt),
          hasSession: Boolean(session),
          hasError: Boolean(sessionError),
        });
      }

      setUser(session?.user ?? null);
      setLoading(false);

      // Network validation is only needed when local storage contains a session.
      // RLS and server endpoints remain the authorization boundary.
      if (!session) return;

      const userStartedAt = performance.now();
      const {
        data: { user: verifiedUser },
        error: userError,
      } = await supabase.auth.getUser();
      if (ignore) return;

      if (process.env.NODE_ENV === "development") {
        console.info("AUTH_BOOTSTRAP_USER", {
          durationMs: Math.round(performance.now() - userStartedAt),
          hasUser: Boolean(verifiedUser),
          hasError: Boolean(userError),
        });
      }

      setUser(verifiedUser);
    }

    void loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
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

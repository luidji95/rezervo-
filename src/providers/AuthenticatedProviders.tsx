"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { AuthorizationProvider } from "@/context/AuthorizationContext";

export function AuthenticatedProviders({ children }: { children: ReactNode }) {
  return <AuthProvider><AuthorizationProvider>{children}</AuthorizationProvider></AuthProvider>;
}

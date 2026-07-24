"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { AuthorizationProvider } from "@/context/AuthorizationContext";
import { EntitlementsProvider } from "@/features/billing/EntitlementsProvider";

export function AuthenticatedProviders({ children }: { children: ReactNode }) {
  return <AuthProvider><AuthorizationProvider><EntitlementsProvider>{children}</EntitlementsProvider></AuthorizationProvider></AuthProvider>;
}

"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { AuthorizationProvider } from "@/context/AuthorizationContext";

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <AuthorizationProvider>{children}</AuthorizationProvider>
    </AuthProvider>
  );
}

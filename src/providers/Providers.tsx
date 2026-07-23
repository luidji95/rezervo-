"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const AuthenticatedProviders = dynamic(() =>
  import("./AuthenticatedProviders").then((module) => module.AuthenticatedProviders)
);

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  const pathname = usePathname();

  // Public booking is intentionally independent from the authenticated app.
  if (pathname.startsWith("/book/")) {
    return children;
  }

  return <AuthenticatedProviders>{children}</AuthenticatedProviders>;
}

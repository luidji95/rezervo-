"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import AppShell from "@/components/layout/AppShell";
import { hasPermission } from "@/features/authorization/permissions";
import { getRoutePermission } from "@/features/authorization/routePermissions";
import { getAppRouteRedirect } from "@/features/authorization/authorizationResolution";

import { SalonProvider } from "@/context/SalonContext";



export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const {
    currentSalon,
    currentRole,
    currentEmployee,
    permissions,
    loading: authorizationLoading,
    resolution,
    error: authorizationError,
  } = useAuthorization();
  const hasRouteAccess = hasPermission(
    permissions,
    getRoutePermission(pathname),
  );

  useEffect(() => {
    if (authLoading || authorizationLoading || authorizationError) return;
    const destination = getAppRouteRedirect({ resolution, hasRouteAccess });
    if (destination) router.replace(destination);

    if (currentRole === "employee" && !currentEmployee) {
      return;
    }
  }, [
    authLoading,
    authorizationError,
    authorizationLoading,
    currentRole,
    currentEmployee,
    currentSalon,
    hasRouteAccess,
    resolution,
    router,
    user,
  ]);

  if (authLoading || authorizationLoading) {
    return <p>Loading...</p>;
  }

  if (authorizationError) {
    return <p role="alert">{authorizationError}</p>;
  }

  if (currentRole === "employee" && !currentEmployee) {
    return (
      <p role="alert">
        Vaš nalog nije pravilno povezan sa zaposlenim. Obratite se vlasniku
        salona.
      </p>
    );
  }

  if (
    !user ||
    !currentSalon ||
    (currentRole === "owner" && !currentSalon.onboarding_completed) ||
    !hasRouteAccess
  ) {
    return null;
  }

  return (
    <SalonProvider>
      <AppShell>{children}</AppShell>
    </SalonProvider>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import AppShell from "@/components/layout/AppShell";
import { getMySalon } from "@/services/salonService";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [checkingSalon, setCheckingSalon] = useState(true);

  useEffect(() => {
    const checkAccess = async () => {
      if (loading) return;

      if (!user) {
        router.replace("/auth/login");
        return;
      }

      try {
        const salon = await getMySalon(user.id);

        if (!salon) {
          router.replace("/onboarding");
          return;
        }

        setCheckingSalon(false);
      } catch (error) {
        console.error("Failed to check salon:", error);
        router.replace("/onboarding");
      }
    };

    checkAccess();
  }, [user, loading, router]);

  if (loading || checkingSalon) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
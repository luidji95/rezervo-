"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import AppShell from "@/components/layout/AppShell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
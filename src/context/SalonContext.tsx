"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/context/AuthContext";
import { getCurrentSalon } from "@/services/salonService";

type CurrentSalon = Awaited<ReturnType<typeof getCurrentSalon>>;

type SalonContextValue = {
  currentSalon: CurrentSalon;
  salonLoading: boolean;
  refetchSalon: () => Promise<void>;
};

const SalonContext = createContext<SalonContextValue | null>(null);

export function SalonProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const [currentSalon, setCurrentSalon] = useState<CurrentSalon>(null);
  const [salonLoading, setSalonLoading] = useState(true);

  const refetchSalon = async () => {
    if (!user) {
      setCurrentSalon(null);
      setSalonLoading(false);
      return;
    }

    setSalonLoading(true);

    try {
      const salon = await getCurrentSalon(user.id);
      setCurrentSalon(salon);
    } catch (error) {
      console.error("Failed to fetch current salon:", error);
      setCurrentSalon(null);
    } finally {
      setSalonLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;

    refetchSalon();
  }, [user, authLoading]);

  return (
    <SalonContext.Provider
      value={{
        currentSalon,
        salonLoading,
        refetchSalon,
      }}
    >
      {children}
    </SalonContext.Provider>
  );
}

export function useSalon() {
  const context = useContext(SalonContext);

  if (!context) {
    throw new Error("useSalon must be used within SalonProvider");
  }

  return context;
}
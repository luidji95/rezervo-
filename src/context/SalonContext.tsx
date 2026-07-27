"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

import { useAuthorization } from "@/context/AuthorizationContext";
import type { CurrentSalon } from "@/services/salonService";

type SalonContextValue = {
  currentSalon: CurrentSalon;
  salonLoading: boolean;
  refetchSalon: () => Promise<unknown>;
};

const SalonContext = createContext<SalonContextValue | null>(null);

export function SalonProvider({ children }: { children: ReactNode }) {
  const {
    currentSalon,
    loading: salonLoading,
    refetchAuthorization: refetchSalon,
  } = useAuthorization();

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

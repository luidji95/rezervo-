"use client";

import { createContext, useContext } from "react";
import type { SalonEntitlements } from "../types/entitlements";

export type EntitlementsContextValue = {
  entitlements: SalonEntitlements | null;
  loading: boolean;
  error: string | null;
  refetchEntitlements: () => Promise<void>;
};

export const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

export function useEntitlements() {
  const context = useContext(EntitlementsContext);
  if (!context) throw new Error("useEntitlements must be used within EntitlementsProvider.");
  return context;
}


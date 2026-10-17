"use client";

import { createContext, useContext } from "react";
import type { SalonEntitlements } from "../types/entitlements";

export type EntitlementsContextValue = {
  entitlements: SalonEntitlements | null;
  loading: boolean;
  error: string | null;
  refetchEntitlements: () => Promise<void>;
  /** Soft re-read that keeps the last valid entitlements on failure. Resolves the fresh entitlements, or null when nothing fresh was read. */
  refreshEntitlements: () => Promise<SalonEntitlements | null>;
};

export const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

export function useEntitlements() {
  const context = useContext(EntitlementsContext);
  if (!context) throw new Error("useEntitlements must be used within EntitlementsProvider.");
  return context;
}


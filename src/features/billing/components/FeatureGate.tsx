"use client";

import type { ReactNode } from "react";
import { useEntitlements } from "../hooks/useEntitlements";
import type { BooleanSalonEntitlement } from "../types/entitlements";
import { UpgradeRequired } from "./UpgradeRequired";

export function FeatureGate({ entitlement, children, fallback }: { entitlement: BooleanSalonEntitlement; children: ReactNode; fallback?: ReactNode }) {
  const state = useEntitlements();
  if (state.loading) return null;
  if (!state.entitlements?.[entitlement]) return fallback ?? <UpgradeRequired />;
  return children;
}

import type { SalonEntitlements } from "../types/entitlements.ts";
import { getEffectiveEmployeeLimit } from "./billingCapacityPresentation.ts";

export type EntitlementLoadState = {
  entitlements: SalonEntitlements | null;
  loading: boolean;
  error: string | null;
};

export function getEntitlementActionState(state: EntitlementLoadState, activeEmployees = 0) {
  const ready = !state.loading && !state.error && state.entitlements !== null;
  const capabilities = ready ? state.entitlements!.effectiveCapabilities : null;
  const limit = getEffectiveEmployeeLimit(state.entitlements);
  return {
    ready,
    loadFailed: !state.loading && Boolean(state.error || !state.entitlements),
    readOnly: ready && state.entitlements!.isReadOnly,
    canManage: capabilities?.canManageBusinessData === true,
    // Deactivation only reduces capacity use and is allowed in read-only access (database-enforced role check).
    canDeactivate: ready,
    canCreateEmployee: capabilities?.canCreateEmployees === true &&
      (limit === null || activeEmployees < limit),
  };
}

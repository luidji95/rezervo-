import type { NormalizedLemonSqueezySubscription } from "../lemonSqueezy/lemonSqueezySubscriptionObjectCore.ts";

export const BILLING_RECONCILIATION_PROVIDER_TIMEOUT_MS=10_000;
export type BillingReconciliationProviderResult = { snapshot: NormalizedLemonSqueezySubscription; rateLimitRemaining: number | null };
export type BillingReconciliationProviderErrorKind = "configuration_error" | "provider_not_found" | "provider_unavailable" | "provider_response_invalid";
export class BillingReconciliationProviderError extends Error {
  readonly kind:BillingReconciliationProviderErrorKind;readonly code:string;readonly stopRun:boolean;
  constructor(kind: BillingReconciliationProviderErrorKind, code: string, stopRun: boolean) {
    super(code); this.name = "BillingReconciliationProviderError";this.kind=kind;this.code=code;this.stopRun=stopRun;
  }
}
export interface BillingReconciliationProvider { retrieveSubscription(providerSubscriptionId: string): Promise<BillingReconciliationProviderResult>; }

import type { BillingCustomerPortalProvider, BillingCustomerPortalRepository } from "./billingCustomerPortalCore.ts";
import { openBillingCustomerPortal } from "./billingCustomerPortalCore.ts";
import { BillingCustomerPortalError } from "./billingCustomerPortalErrors.ts";

export type PortalEndpointDependencies = {
  authenticate(request: Request): Promise<{ userId: string; repository: BillingCustomerPortalRepository } | null>;
  getProvider(): BillingCustomerPortalProvider;
};

export type PortalEndpointResult = {
  status: number;
  body: { success: false; code: string } | { success: true; portal: { url: string } };
  headers: { "Cache-Control": "no-store" };
};

function failure(code: string, status: number): PortalEndpointResult {
  return { status, body: { success: false, code }, headers: { "Cache-Control": "no-store" } };
}

export async function handleBillingCustomerPortalPost(request: Request, dependencies: PortalEndpointDependencies): Promise<PortalEndpointResult> {
  const authentication = await dependencies.authenticate(request);
  if (!authentication) return failure("BILLING_PORTAL_UNAUTHORIZED", 401);
  if ((await request.text()).length > 0) return failure("BILLING_PORTAL_REQUEST_INVALID", 400);
  try {
    const portal = await openBillingCustomerPortal({ userId: authentication.userId, repository: authentication.repository, provider: dependencies.getProvider() });
    return { status: 200, body: { success: true, portal }, headers: { "Cache-Control": "no-store" } };
  } catch (error) {
    if (error instanceof BillingCustomerPortalError) return failure(error.code, error.status);
    return failure("BILLING_PORTAL_INTERNAL_ERROR", 500);
  }
}

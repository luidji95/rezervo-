export type BillingCheckoutClientRequest = {
  salonId: string;
  planCode: "starter" | "pro";
};

export function buildBillingCheckoutClientRequest(
  salonId: string,
  planCode: BillingCheckoutClientRequest["planCode"],
): BillingCheckoutClientRequest {
  return { salonId, planCode };
}

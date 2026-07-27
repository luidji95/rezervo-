import { z } from "zod";

import { BillingCheckoutError } from "../providers/billingCheckoutErrors.ts";

const schema = z
  .object({
    salonId: z.uuid(),
    planCode: z.enum(["starter", "pro"]),
    idempotencyKey: z.uuid().optional(),
  })
  .strict();

export function parseBillingCheckoutRequest(body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BillingCheckoutError("INVALID_INPUT", 400);
  }
  return parsed.data;
}

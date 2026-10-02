import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import {
  SupabaseBillingCheckoutRecoveryRepository,
  type CheckoutRecoverySupabaseClient,
} from "./supabaseBillingCheckoutRecoveryRepository";

export function createSupabaseBillingCheckoutRecoveryRepository(
  client: CheckoutRecoverySupabaseClient = supabaseServer as unknown as CheckoutRecoverySupabaseClient,
) {
  return new SupabaseBillingCheckoutRecoveryRepository(client);
}

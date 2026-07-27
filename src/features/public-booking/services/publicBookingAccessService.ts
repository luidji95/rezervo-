import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";

type SalonAccessRow = { has_full_access: boolean };

export async function hasPublicBookingAccess(salonId: string): Promise<boolean> {
  const { data, error } = await supabaseServer.rpc("resolve_salon_access_v1", {
    p_salon_id: salonId,
  });

  if (error) throw error;
  const row = (data as SalonAccessRow[] | null)?.[0];
  return row?.has_full_access === true;
}

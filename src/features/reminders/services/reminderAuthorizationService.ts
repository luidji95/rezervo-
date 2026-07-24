import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";

export async function canManageSalonReminders(userId: string, salonId: string) {
  const [{ data: salon, error: salonError }, { data: membership, error: membershipError }] = await Promise.all([
    supabaseServer.from("salons").select("owner_id").eq("id", salonId).maybeSingle(),
    supabaseServer.from("salon_members").select("id").eq("salon_id", salonId).eq("profile_id", userId).eq("status", "active").in("role", ["owner", "manager"]).maybeSingle(),
  ]);
  if (salonError || membershipError) throw new Error("REMINDER_AUTHORIZATION_FAILED");
  return Boolean(salon && (salon.owner_id === userId || membership));
}


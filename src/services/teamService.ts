import { supabase } from "@/lib/supabase/client";
import type { SalonMember } from "@/types/team";

const salonMemberSelect = `
  id,
  salon_id,
  profile_id,
  role,
  status,
  joined_at
`;

export async function getSalonMembers(
  salonId: string
): Promise<SalonMember[]> {
  const { data, error } = await supabase
    .from("salon_members")
    .select(salonMemberSelect)
    .eq("salon_id", salonId)
    .order("joined_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as SalonMember[];
}

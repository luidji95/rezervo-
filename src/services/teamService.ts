import { supabase } from "@/lib/supabase/client";
import type { SalonMember, TeamProfile } from "@/types/team";

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

export async function getTeamProfiles(
  profileIds: string[],
): Promise<TeamProfile[]> {
  const uniqueProfileIds = [...new Set(profileIds.filter(Boolean))];

  if (uniqueProfileIds.length === 0) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", uniqueProfileIds);

  if (error) throw error;
  return (data ?? []) as TeamProfile[];
}

import { supabase } from "@/lib/supabase/client";
import {
  getCurrentSalon,
  getSalonById,
} from "@/services/salonService";
import type { Employee } from "@/types/employee";
import type {
  AuthorizationSnapshot,
  CurrentMembership,
  CurrentProfile,
} from "../types";
import { getPermissions } from "../permissions";

const PROFILE_SELECT = "id, full_name, email, avatar_url, global_role";
const MEMBERSHIP_SELECT = `
  id,
  salon_id,
  profile_id,
  role,
  status,
  joined_at,
  created_at
`;
const EMPLOYEE_SELECT = `
  id,
  salon_id,
  profile_id,
  full_name,
  display_name,
  public_slug,
  bio,
  position,
  avatar_url,
  phone,
  email,
  is_active,
  is_bookable,
  is_public,
  sort_order,
  created_at,
  updated_at
`;

async function getProfile(userId: string): Promise<CurrentProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as CurrentProfile | null;
}

async function getActiveMembership(
  userId: string,
): Promise<CurrentMembership | null> {
  const { data, error } = await supabase
    .from("salon_members")
    .select(MEMBERSHIP_SELECT)
    .eq("profile_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as CurrentMembership | null;
}

async function getLinkedEmployee({
  salonId,
  profileId,
}: {
  salonId: string;
  profileId: string;
}): Promise<Employee | null> {
  const { data, error } = await supabase
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("salon_id", salonId)
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data as Employee | null;
}

export async function loadAuthorizationSnapshot(
  userId: string,
): Promise<AuthorizationSnapshot> {
  const [currentProfile, currentMembership] = await Promise.all([
    getProfile(userId),
    getActiveMembership(userId),
  ]);

  if (currentMembership) {
    const currentRole = currentMembership.role;
    const currentSalon = await getSalonById(currentMembership.salon_id);

    if (!currentSalon) {
      throw new Error("Salon povezan sa članstvom nije pronađen.");
    }

    const currentEmployee =
      currentRole === "employee"
        ? await getLinkedEmployee({
            salonId: currentMembership.salon_id,
            profileId: userId,
          })
        : null;

    return {
      currentProfile,
      currentMembership,
      currentRole,
      currentSalon,
      currentEmployee,
      permissions: getPermissions(currentRole),
      source: "membership",
    };
  }

  const ownerSalon = await getCurrentSalon(userId);

  if (ownerSalon) {
    return {
      currentProfile,
      currentMembership: null,
      currentRole: "owner",
      currentSalon: ownerSalon,
      currentEmployee: null,
      permissions: getPermissions("owner"),
      source: "owner_fallback",
    };
  }

  return {
    currentProfile,
    currentMembership: null,
    currentRole: null,
    currentSalon: null,
    currentEmployee: null,
    permissions: getPermissions(null),
    source: null,
  };
}

export async function getPostLoginPath(userId: string) {
  const authorization = await loadAuthorizationSnapshot(userId);

  if (!authorization.currentSalon) return "/onboarding";

  if (
    authorization.currentRole === "owner" &&
    !authorization.currentSalon.onboarding_completed
  ) {
    return "/onboarding";
  }

  return "/dashboard";
}

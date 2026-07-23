import type { CurrentSalon } from "@/services/salonService";
import type { Employee } from "@/types/employee";

export type AuthorizationRole = "owner" | "manager" | "employee";

export type CurrentProfile = {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  global_role: string;
};

export type CurrentMembership = {
  id: string;
  salon_id: string;
  profile_id: string;
  role: AuthorizationRole;
  status: "active";
  joined_at: string | null;
  created_at: string;
};

export type AuthorizationPermissions = {
  canViewDashboard: boolean;
  canViewCalendar: boolean;
  canViewAppointments: boolean;
  canViewClients: boolean;
  canViewAnalytics: boolean;
  canViewStatistics: boolean;
  canManageSalon: boolean;
  canManageEmployees: boolean;
  canManageServices: boolean;
  canManageSettings: boolean;
  canManageBilling: boolean;
  canViewSalonFinancials: boolean;
  canViewAllAppointments: boolean;
  canViewOwnAppointments: boolean;
  canViewNotifications: boolean;
};

export type AuthorizationSource = "membership" | "owner_fallback" | null;

export type AuthorizationSnapshot = {
  currentProfile: CurrentProfile | null;
  currentMembership: CurrentMembership | null;
  currentRole: AuthorizationRole | null;
  currentSalon: CurrentSalon;
  currentEmployee: Employee | null;
  permissions: AuthorizationPermissions;
  source: AuthorizationSource;
};

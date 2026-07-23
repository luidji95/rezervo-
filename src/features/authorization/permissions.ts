import type {
  AuthorizationPermissions,
  AuthorizationRole,
} from "./types";

export type Permission = keyof AuthorizationPermissions;

const CLOSED_PERMISSIONS: AuthorizationPermissions = {
  canViewDashboard: false,
  canViewCalendar: false,
  canViewAppointments: false,
  canViewClients: false,
  canViewAnalytics: false,
  canManageSalon: false,
  canManageEmployees: false,
  canManageServices: false,
  canManageSettings: false,
  canManageBilling: false,
  canViewSalonFinancials: false,
  canViewAllAppointments: false,
  canViewOwnAppointments: false,
  canViewNotifications: false,
};

export function getPermissions(
  role: AuthorizationRole | null,
): AuthorizationPermissions {
  if (role === "owner" || role === "manager") {
    return {
      canViewDashboard: true,
      canViewCalendar: true,
      canViewAppointments: true,
      canViewClients: true,
      canViewAnalytics: true,
      canManageSalon: true,
      canManageEmployees: true,
      canManageServices: true,
      canManageSettings: true,
      canManageBilling: role === "owner",
      canViewSalonFinancials: true,
      canViewAllAppointments: true,
      canViewOwnAppointments: true,
      canViewNotifications: true,
    };
  }

  if (role === "employee") {
    return {
      ...CLOSED_PERMISSIONS,
      canViewDashboard: true,
      canViewCalendar: true,
      canViewAppointments: true,
      canViewOwnAppointments: true,
      canViewNotifications: true,
    };
  }

  return { ...CLOSED_PERMISSIONS };
}

export function hasPermission(
  permissions: AuthorizationPermissions,
  permission: Permission,
) {
  return permissions[permission];
}

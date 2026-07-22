import type { Permission } from "./permissions";

type ProtectedRouteRule = {
  path: string;
  permission: Permission;
};

export const PROTECTED_ROUTE_PERMISSIONS: readonly ProtectedRouteRule[] = [
  { path: "/dashboard", permission: "canViewDashboard" },
  { path: "/calendar", permission: "canViewCalendar" },
  { path: "/appointmets", permission: "canViewAppointments" },
  { path: "/clients", permission: "canViewClients" },
  { path: "/services", permission: "canManageServices" },
  { path: "/employees", permission: "canManageEmployees" },
  { path: "/settings", permission: "canManageSettings" },
  { path: "/working-hours", permission: "canManageSettings" },
  { path: "/closures", permission: "canManageSettings" },
  { path: "/appointment-test", permission: "canManageSalon" },
  { path: "/availability-test", permission: "canManageSalon" },
];

export function getRoutePermission(pathname: string): Permission {
  const matchingRule = PROTECTED_ROUTE_PERMISSIONS.find(
    ({ path }) => pathname === path || pathname.startsWith(`${path}/`),
  );

  // Unknown protected routes stay owner/manager-only by default.
  return matchingRule?.permission ?? "canManageSalon";
}

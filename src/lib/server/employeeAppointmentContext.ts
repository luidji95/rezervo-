import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";

export type EmployeeAppointmentContext = {
  salonId: string;
  salonTimeZone: string | null;
  employeeId: string;
};

export async function getEmployeeAppointmentAccessError(profileId: string) {
  const { data: membership } = await supabaseServer
    .from("salon_members")
    .select("salon_id")
    .eq("profile_id", profileId)
    .eq("role", "employee")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!membership) return "FORBIDDEN" as const;

  const { data: employee } = await supabaseServer
    .from("employees")
    .select("id, is_active, is_bookable")
    .eq("salon_id", membership.salon_id)
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();
  if (!employee) return "EMPLOYEE_NOT_LINKED" as const;
  if (!employee.is_active || !employee.is_bookable) {
    return "EMPLOYEE_NOT_ACTIVE" as const;
  }
  return "FORBIDDEN" as const;
}

export async function getEmployeeAppointmentContext(
  profileId: string,
  serviceId?: string,
): Promise<EmployeeAppointmentContext | null> {
  const { data: memberships, error: membershipError } = await supabaseServer
    .from("salon_members")
    .select("salon_id, salons!inner(id, timezone, status)")
    .eq("profile_id", profileId)
    .eq("role", "employee")
    .eq("status", "active")
    .eq("salons.status", "active")
    .order("created_at", { ascending: true });

  if (membershipError || !memberships?.length) return null;
  const salonIds = memberships.map((membership) => membership.salon_id);

  const { data: employees, error: employeeError } = await supabaseServer
    .from("employees")
    .select("id, salon_id")
    .in("salon_id", salonIds)
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .eq("is_bookable", true);

  if (employeeError || !employees?.length) return null;

  let employee = employees[0];

  if (serviceId) {
    const { data: assignment, error: assignmentError } = await supabaseServer
      .from("employee_services")
      .select("id, employee_id, services!inner(id, is_active)")
      .in("employee_id", employees.map((item) => item.id))
      .eq("service_id", serviceId)
      .eq("is_active", true)
      .eq("services.is_active", true)
      .maybeSingle();
    if (assignmentError || !assignment) return null;
    employee = employees.find((item) => item.id === assignment.employee_id) ?? employee;
  }

  const membership = memberships.find((item) => item.salon_id === employee.salon_id);
  if (!membership) return null;

  const salon = membership.salons as unknown as {
    id: string;
    timezone: string | null;
    status: string;
  };
  return {
    salonId: salon.id,
    salonTimeZone: salon.timezone,
    employeeId: employee.id,
  };
}

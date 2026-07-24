import { supabase } from "@/lib/supabase/client";

import type {
  CreateEmployeeInput,
  Employee,
  UpdateEmployeeInput,
} from "@/types/employee";

const employeeSelect = `
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

export async function createEmployee({
  salonId,
  fullName,
  displayName,
  position,
  phone,
  email,
  bio,
}: CreateEmployeeInput): Promise<Employee> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("UNAUTHORIZED");
  const response = await fetch("/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ salonId, fullName, displayName, position, phone, email, bio }),
  });
  const body = await response.json().catch(() => null) as
    | { success: true; employee: Employee }
    | { success: false; code?: string; message?: string }
    | null;
  if (!response.ok || !body?.success) {
    const error = new Error(body && "message" in body ? body.message : "EMPLOYEE_CREATE_FAILED");
    error.name = body && "code" in body && body.code ? body.code : "EMPLOYEE_CREATE_FAILED";
    throw error;
  }
  return body.employee;
}

export async function getSalonEmployees(
  salonId: string
): Promise<Employee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select(employeeSelect)
    .eq("salon_id", salonId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Employee[];
}

export async function updateEmployee({
  employeeId,
  salonId,
  fullName,
  displayName,
  position,
  phone,
  email,
  bio,
  isActive,
  isBookable,
  isPublic,
}: UpdateEmployeeInput): Promise<Employee> {
  let query = supabase
    .from("employees")
    .update({
      full_name: fullName,
      display_name: displayName,
      position,
      phone,
      email,
      bio,
      ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
      ...(typeof isBookable === "boolean"
        ? { is_bookable: isBookable }
        : {}),
      ...(typeof isPublic === "boolean" ? { is_public: isPublic } : {}),
    })
    .eq("id", employeeId);

  if (salonId) {
    query = query.eq("salon_id", salonId);
  }

  const { data, error } = await query.select(employeeSelect).single();

  if (error) {
    throw error;
  }

  return data as Employee;
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .delete()
    .eq("id", employeeId);

  if (error) {
    throw error;
  }
}

export type DeleteEmployeeSafelyResult = {
  mode: "hard" | "soft";
};

export class EmployeeHasFutureAppointmentsError extends Error {
  constructor() {
    super("Employee has future appointments.");
    this.name = "EmployeeHasFutureAppointmentsError";
  }
}

export async function deleteEmployeeSafely({
  employeeId,
  salonId,
}: {
  employeeId: string;
  salonId: string;
}): Promise<DeleteEmployeeSafelyResult> {
  const now = new Date().toISOString();
  const { data: futureAppointments, error: futureError } = await supabase
    .from("appointments")
    .select("id")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId)
    .in("status", ["pending", "confirmed"])
    .gte("start_time", now)
    .limit(1);

  if (futureError) throw futureError;
  if (futureAppointments?.length) {
    throw new EmployeeHasFutureAppointmentsError();
  }

  const { data: appointmentHistory, error: historyError } = await supabase
    .from("appointments")
    .select("id")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId)
    .limit(1);

  if (historyError) throw historyError;

  if (appointmentHistory?.length) {
    const { error } = await supabase
      .from("employees")
      .update({
        is_active: false,
        is_bookable: false,
        is_public: false,
      })
      .eq("id", employeeId)
      .eq("salon_id", salonId);

    if (error) throw error;
    return { mode: "soft" };
  }

  const { error } = await supabase
    .from("employees")
    .delete()
    .eq("id", employeeId)
    .eq("salon_id", salonId);

  if (error) throw error;
  return { mode: "hard" };
}

export async function restoreEmployee({
  employeeId,
  salonId,
}: {
  employeeId: string;
  salonId: string;
}): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .update({ is_active: true })
    .eq("id", employeeId)
    .eq("salon_id", salonId);

  if (error) throw error;
}

export class OwnerEmployeeAlreadyLinkedError extends Error {
  constructor() {
    super("Owner is already linked to another employee in this salon.");
    this.name = "OwnerEmployeeAlreadyLinkedError";
  }
}

export async function linkEmployeeToCurrentOwner({
  employeeId,
  salonId,
}: {
  employeeId: string;
  salonId: string;
}): Promise<Employee> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Prijava je potrebna za povezivanje zaposlenog.");
  }

  const { data: salon, error: salonError } = await supabase
    .from("salons")
    .select("id, owner_id")
    .eq("id", salonId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (salonError) throw salonError;
  if (!salon) {
    throw new Error("Samo vlasnik salona može povezati svoj nalog.");
  }

  const { data: existingLink, error: existingLinkError } = await supabase
    .from("employees")
    .select("id")
    .eq("salon_id", salonId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (existingLinkError) throw existingLinkError;
  if (existingLink && existingLink.id !== employeeId) {
    throw new OwnerEmployeeAlreadyLinkedError();
  }

  const { data, error } = await supabase
    .from("employees")
    .update({ profile_id: user.id })
    .eq("id", employeeId)
    .eq("salon_id", salonId)
    .is("profile_id", null)
    .select(employeeSelect)
    .maybeSingle();

  if (error?.code === "23505") {
    throw new OwnerEmployeeAlreadyLinkedError();
  }

  if (error) throw error;
  if (!data) {
    throw new Error("Zaposleni je već povezan sa drugim nalogom.");
  }

  return data as Employee;
}

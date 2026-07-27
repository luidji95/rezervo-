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

async function employeeMutation(method: "PATCH" | "DELETE", body: object) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("UNAUTHORIZED");
  const response = await fetch("/api/employees", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null) as { success?: boolean; employee?: Employee; mode?: "hard" | "soft"; code?: string; message?: string } | null;
  if (!response.ok || !result?.success) {
    const error = new Error(result?.message ?? "EMPLOYEE_MUTATION_FAILED");
    error.name = result?.code ?? "EMPLOYEE_MUTATION_FAILED";
    throw error;
  }
  return result;
}

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
  void salonId;
  const details = await employeeMutation("PATCH", { action: "update_details", employeeId, fullName, displayName, position, phone, email, bio, isBookable: isBookable ?? null, isPublic: isPublic ?? null });
  if (typeof isActive === "boolean" && details.employee?.is_active !== isActive) {
    const active = await employeeMutation("PATCH", { action: "set_active", employeeId, isActive });
    return active.employee as Employee;
  }
  return details.employee as Employee;
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  await employeeMutation("DELETE", { employeeId });
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
  void salonId;
  try {
    const result = await employeeMutation("DELETE", { employeeId });
    return { mode: result.mode ?? "soft" };
  } catch (error) {
    if (error instanceof Error && error.name === "EMPLOYEE_HAS_FUTURE_APPOINTMENTS") throw new EmployeeHasFutureAppointmentsError();
    throw error;
  }
}

export async function restoreEmployee({
  employeeId,
  salonId,
}: {
  employeeId: string;
  salonId: string;
}): Promise<void> {
  void salonId;
  await employeeMutation("PATCH", { action: "set_active", employeeId, isActive: true });
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
  void salonId;
  try {
    const result = await employeeMutation("PATCH", { action: "link_current_owner", employeeId });
    return result.employee as Employee;
  } catch (error) {
    if (error instanceof Error && error.name === "EMPLOYEE_ALREADY_LINKED") throw new OwnerEmployeeAlreadyLinkedError();
    throw error;
  }
}

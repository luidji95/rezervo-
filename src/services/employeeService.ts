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
  const { data, error } = await supabase
    .from("employees")
    .insert({
      salon_id: salonId,
      full_name: fullName,
      display_name: displayName,
      position,
      phone,
      email,
      bio,
    })
    .select(employeeSelect)
    .single();

  if (error) {
    throw error;
  }

  return data as Employee;
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
  fullName,
  displayName,
  position,
  phone,
  email,
  bio,
}: UpdateEmployeeInput): Promise<Employee> {
  const { data, error } = await supabase
    .from("employees")
    .update({
      full_name: fullName,
      display_name: displayName,
      position,
      phone,
      email,
      bio,
    })
    .eq("id", employeeId)
    .select(employeeSelect)
    .single();

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
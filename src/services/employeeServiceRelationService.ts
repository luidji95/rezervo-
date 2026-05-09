import { supabase } from "@/lib/supabase/client";

import type {
  AssignServiceToEmployeeInput,
  EmployeeService,
  RemoveServiceFromEmployeeInput,
} from "@/types/employeeService";

const employeeServiceSelect = `
  id,
  salon_id,
  employee_id,
  service_id,
  custom_duration_minutes,
  custom_price,
  is_active,
  created_at
`;

export async function assignServiceToEmployee({
  salonId,
  employeeId,
  serviceId,
  customDurationMinutes = null,
  customPrice = null,
}: AssignServiceToEmployeeInput): Promise<EmployeeService> {
  const { data, error } = await supabase
    .from("employee_services")
    .insert({
      salon_id: salonId,
      employee_id: employeeId,
      service_id: serviceId,
      custom_duration_minutes: customDurationMinutes,
      custom_price: customPrice,
    })
    .select(employeeServiceSelect)
    .single();

  if (error) {
    throw error;
  }

  return data as EmployeeService;
}

export async function getEmployeeServices(
  employeeId: string
): Promise<EmployeeService[]> {
  const { data, error } = await supabase
    .from("employee_services")
    .select(employeeServiceSelect)
    .eq("employee_id", employeeId)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return (data ?? []) as EmployeeService[];
}

export async function removeServiceFromEmployee({
  employeeId,
  serviceId,
}: RemoveServiceFromEmployeeInput): Promise<void> {
  const { error } = await supabase
    .from("employee_services")
    .delete()
    .eq("employee_id", employeeId)
    .eq("service_id", serviceId);

  if (error) {
    throw error;
  }
}

export async function getSalonEmployeeServices(
  salonId: string
): Promise<EmployeeService[]> {
  const { data, error } = await supabase
    .from("employee_services")
    .select(employeeServiceSelect)
    .eq("salon_id", salonId)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return (data ?? []) as EmployeeService[];
}
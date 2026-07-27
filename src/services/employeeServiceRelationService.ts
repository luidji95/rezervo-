import { supabase } from "@/lib/supabase/client";
import { throwBusinessDataMutationError } from "@/features/business-data/services/businessDataMutationError";
import type { AssignServiceToEmployeeInput, EmployeeService, RemoveServiceFromEmployeeInput } from "@/types/employeeService";

const employeeServiceSelect = `id, salon_id, employee_id, service_id, custom_duration_minutes, custom_price, is_active, created_at`;

export async function assignServiceToEmployee({ salonId, employeeId, serviceId, customDurationMinutes = null, customPrice = null }: AssignServiceToEmployeeInput): Promise<EmployeeService> {
  const { data, error } = await supabase.rpc("upsert_employee_service_assignment_v1", {
    p_salon_id: salonId, p_employee_id: employeeId, p_service_id: serviceId,
    p_custom_duration_minutes: customDurationMinutes, p_custom_price: customPrice, p_is_active: true,
  });
  if (error) throwBusinessDataMutationError(error);
  return data as EmployeeService;
}

export async function getEmployeeServices(employeeId: string): Promise<EmployeeService[]> {
  const { data, error } = await supabase.from("employee_services").select(employeeServiceSelect).eq("employee_id", employeeId).eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as EmployeeService[];
}

export async function removeServiceFromEmployee({ employeeId, serviceId }: RemoveServiceFromEmployeeInput): Promise<void> {
  const { error } = await supabase.rpc("remove_employee_service_assignment_v1", { p_employee_id: employeeId, p_service_id: serviceId });
  if (error) throwBusinessDataMutationError(error);
}

export async function getSalonEmployeeServices(salonId: string): Promise<EmployeeService[]> {
  const { data, error } = await supabase.from("employee_services").select(employeeServiceSelect).eq("salon_id", salonId).eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as EmployeeService[];
}

export async function getEmployeeServiceIds({ employeeId, salonId }: { employeeId: string; salonId: string }): Promise<string[]> {
  const { data, error } = await supabase.from("employee_services").select("service_id").eq("salon_id", salonId).eq("employee_id", employeeId).eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((relation) => relation.service_id);
}

export async function syncEmployeeServices({ employeeId, salonId, serviceIds }: { employeeId: string; salonId: string; serviceIds: string[] }): Promise<void> {
  const { error } = await supabase.rpc("sync_employee_service_assignments_v1", {
    p_salon_id: salonId, p_employee_id: employeeId, p_service_ids: serviceIds,
  });
  if (error) throwBusinessDataMutationError(error);
}

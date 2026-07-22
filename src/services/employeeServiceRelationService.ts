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

export async function getEmployeeServiceIds({
  employeeId,
  salonId,
}: {
  employeeId: string;
  salonId: string;
}): Promise<string[]> {
  const { data, error } = await supabase
    .from("employee_services")
    .select("service_id")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId)
    .eq("is_active", true);

  if (error) throw error;
  return (data ?? []).map((relation) => relation.service_id);
}

export async function syncEmployeeServices({
  employeeId,
  salonId,
  serviceIds,
}: {
  employeeId: string;
  salonId: string;
  serviceIds: string[];
}): Promise<void> {
  const submittedIds = [...new Set(serviceIds)];

  if (submittedIds.length) {
    const { data: validServices, error: servicesError } = await supabase
      .from("services")
      .select("id")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .in("id", submittedIds);

    if (servicesError) throw servicesError;
    if ((validServices ?? []).length !== submittedIds.length) {
      throw new Error("Jedna ili više usluga nisu dostupne u ovom salonu.");
    }
  }

  const { data: existingRelations, error: relationsError } = await supabase
    .from("employee_services")
    .select("id, service_id, is_active")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId);

  if (relationsError) throw relationsError;

  const submittedSet = new Set(submittedIds);
  const existingByServiceId = new Map(
    (existingRelations ?? []).map((relation) => [relation.service_id, relation])
  );
  const relationsToActivate = (existingRelations ?? [])
    .filter(
      (relation) => submittedSet.has(relation.service_id) && !relation.is_active
    )
    .map((relation) => relation.id);
  const relationsToDeactivate = (existingRelations ?? [])
    .filter(
      (relation) => !submittedSet.has(relation.service_id) && relation.is_active
    )
    .map((relation) => relation.id);
  const missingServiceIds = submittedIds.filter(
    (serviceId) => !existingByServiceId.has(serviceId)
  );

  const operations: PromiseLike<unknown>[] = [];

  if (relationsToActivate.length) {
    operations.push(
      supabase
        .from("employee_services")
        .update({ is_active: true })
        .eq("salon_id", salonId)
        .eq("employee_id", employeeId)
        .in("id", relationsToActivate)
        .then(({ error }) => {
          if (error) throw error;
        })
    );
  }

  if (relationsToDeactivate.length) {
    operations.push(
      supabase
        .from("employee_services")
        .update({ is_active: false })
        .eq("salon_id", salonId)
        .eq("employee_id", employeeId)
        .in("id", relationsToDeactivate)
        .then(({ error }) => {
          if (error) throw error;
        })
    );
  }

  if (missingServiceIds.length) {
    operations.push(
      supabase
        .from("employee_services")
        .insert(
          missingServiceIds.map((serviceId) => ({
            salon_id: salonId,
            employee_id: employeeId,
            service_id: serviceId,
            is_active: true,
          }))
        )
        .then(({ error }) => {
          if (error) throw error;
        })
    );
  }

  await Promise.all(operations);
}

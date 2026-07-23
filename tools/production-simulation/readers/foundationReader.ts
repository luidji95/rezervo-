import type { SupabaseClient } from "@supabase/supabase-js";

export type FoundationServiceAssignment = {
  employeeId: string;
  serviceId: string;
  employeeName: string;
  serviceName: string;
  durationMinutes: number;
  bufferMinutes: number;
  price: number;
  currency: string;
};

export type SimulationFoundation = {
  salon: {
    id: string;
    name: string;
    timezone: string;
    currency: string;
  };
  assignments: FoundationServiceAssignment[];
  workingHoursCount: number;
  closuresCount: number;
};

export async function readSimulationFoundation(
  supabase: SupabaseClient,
  salonId: string,
): Promise<SimulationFoundation> {
  const [salonResult, employeeResult, serviceResult, relationResult, hoursResult, closuresResult] =
    await Promise.all([
      supabase
        .from("salons")
        .select("id,name,timezone,default_currency,status")
        .eq("id", salonId)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id,full_name,display_name,is_active,is_bookable")
        .eq("salon_id", salonId)
        .eq("is_active", true),
      supabase
        .from("services")
        .select("id,name,duration_minutes,buffer_minutes,price,currency,is_active")
        .eq("salon_id", salonId)
        .eq("is_active", true),
      supabase
        .from("employee_services")
        .select("employee_id,service_id,custom_duration_minutes,custom_price,is_active")
        .eq("salon_id", salonId)
        .eq("is_active", true),
      supabase
        .from("working_hours")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId),
      supabase
        .from("closures")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId),
    ]);

  const firstError = [
    salonResult.error,
    employeeResult.error,
    serviceResult.error,
    relationResult.error,
    hoursResult.error,
    closuresResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(`Foundation read failed: ${firstError.message}`);
  if (!salonResult.data) throw new Error("The requested salon does not exist.");
  if (salonResult.data.status !== "active") throw new Error("The requested salon is not active.");

  const employees = new Map((employeeResult.data ?? []).map((employee) => [employee.id, employee]));
  const services = new Map((serviceResult.data ?? []).map((service) => [service.id, service]));
  if (employees.size === 0) throw new Error("The salon has no active employees.");
  if (services.size === 0) throw new Error("The salon has no active services.");

  const assignments = (relationResult.data ?? [])
    .flatMap((relation) => {
      const employee = employees.get(relation.employee_id);
      const service = services.get(relation.service_id);
      if (!employee || !service) return [];
      return [{
        employeeId: employee.id,
        serviceId: service.id,
        employeeName: employee.display_name || employee.full_name,
        serviceName: service.name,
        durationMinutes: relation.custom_duration_minutes ?? service.duration_minutes,
        bufferMinutes: service.buffer_minutes ?? 0,
        price: Number(relation.custom_price ?? service.price),
        currency: service.currency,
      }];
    })
    .sort((first, second) =>
      `${first.employeeId}:${first.serviceId}`.localeCompare(`${second.employeeId}:${second.serviceId}`),
    );

  if (assignments.length === 0) {
    throw new Error("The salon has no active employee_services assignment.");
  }

  return {
    salon: {
      id: salonResult.data.id,
      name: salonResult.data.name,
      timezone: salonResult.data.timezone || "Europe/Belgrade",
      currency: salonResult.data.default_currency || assignments[0].currency || "RSD",
    },
    assignments,
    workingHoursCount: hoursResult.count ?? 0,
    closuresCount: closuresResult.count ?? 0,
  };
}

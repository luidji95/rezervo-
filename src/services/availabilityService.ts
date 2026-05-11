import { supabase } from "@/lib/supabase/client";
import type {
  GenerateAvailableSlotsInput,
  GenerateAvailableSlotsResult,
} from "@/types/availability";

type SupabaseClientLike = typeof supabase;

function combineDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function overlaps(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA < endB && endA > startB;
}

export async function generateAvailableSlots(
  input: GenerateAvailableSlotsInput,
  supabaseClient: SupabaseClientLike = supabase
): Promise<GenerateAvailableSlotsResult> {
  const { salonId, serviceId, employeeId, date } = input;

  const [serviceRes, employeesRes] = await Promise.all([
    supabaseClient
      .from("services")
      .select("id, duration_minutes, buffer_minutes")
      .eq("id", serviceId)
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .single(),

    supabaseClient
      .from("employees")
      .select(
        `
        *,
        employee_services!inner(service_id, salon_id, is_active)
      `
      )
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .eq("is_bookable", true)
      .eq("employee_services.salon_id", salonId)
      .eq("employee_services.service_id", serviceId)
      .eq("employee_services.is_active", true)
      .match(employeeId ? { id: employeeId } : {}),
  ]);

  if (serviceRes.error || !serviceRes.data) {
    throw new Error("Service not found or inactive.");
  }

  if (employeesRes.error) {
    throw new Error("Failed to fetch employees.");
  }

  const service = serviceRes.data;
  const compatibleEmployees = employeesRes.data ?? [];

  if (compatibleEmployees.length === 0) {
    return { slots: [] };
  }

  const targetDate = new Date(`${date}T00:00:00`);
  const dayOfWeek = targetDate.getDay();

  const compatibleEmployeeIds = compatibleEmployees.map(
    (employee) => employee.id
  );

  const dayStart = combineDateAndTime(date, "00:00:00");
  const dayEnd = combineDateAndTime(date, "23:59:59");

  const [workingHoursRes, closuresRes, appointmentsRes] = await Promise.all([
    supabaseClient
      .from("working_hours")
      .select("*")
      .eq("salon_id", salonId)
      .eq("day_of_week", dayOfWeek)
      .or(
        `employee_id.is.null,employee_id.in.(${compatibleEmployeeIds.join(",")})`
      ),

    supabaseClient
      .from("closures")
      .select("*")
      .eq("salon_id", salonId)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),

    supabaseClient
      .from("appointments")
      .select("*")
      .eq("salon_id", salonId)
      .in("employee_id", compatibleEmployeeIds)
      .lt("start_time", dayEnd.toISOString())
      .gt("end_time", dayStart.toISOString())
      .not("status", "in", "(cancelled,no_show)"),
  ]);

  if (workingHoursRes.error) {
    throw new Error("Failed to fetch working hours.");
  }

  if (closuresRes.error) {
    throw new Error("Failed to fetch closures.");
  }

  if (appointmentsRes.error) {
    throw new Error("Failed to fetch appointments.");
  }

  const workingHours = workingHoursRes.data ?? [];
  const closures = closuresRes.data ?? [];
  const appointments = appointmentsRes.data ?? [];

  const getEmployeeSchedule = (targetEmployeeId: string) => {
    const employeeOverride = workingHours.find(
      (hours) => hours.employee_id === targetEmployeeId
    );

    if (employeeOverride) {
      return employeeOverride;
    }

    return workingHours.find((hours) => hours.employee_id === null) ?? null;
  };

  const slots: GenerateAvailableSlotsResult["slots"] = [];

  for (const employee of compatibleEmployees) {
    const schedule = getEmployeeSchedule(employee.id);

    if (!schedule || !schedule.is_working_day) {
      continue;
    }

    const relevantClosures = closures.filter(
      (closure) =>
        closure.employee_id === null || closure.employee_id === employee.id
    );

    const relevantAppointments = appointments.filter(
      (appointment) => appointment.employee_id === employee.id
    );

    const workStart = combineDateAndTime(date, schedule.opens_at);
    const workEnd = combineDateAndTime(date, schedule.closes_at);

    const breakStart = schedule.break_starts_at
      ? combineDateAndTime(date, schedule.break_starts_at)
      : null;

    const breakEnd = schedule.break_ends_at
      ? combineDateAndTime(date, schedule.break_ends_at)
      : null;

    const appointmentDuration =
      service.duration_minutes + service.buffer_minutes;

    let currentSlotStart = workStart;

    while (true) {
      const currentSlotEnd = addMinutes(currentSlotStart, appointmentDuration);

      if (currentSlotEnd > workEnd) {
        break;
      }

      const conflictsWithBreak =
        breakStart &&
        breakEnd &&
        overlaps(currentSlotStart, currentSlotEnd, breakStart, breakEnd);

      const conflictsWithClosure = relevantClosures.some((closure) =>
        overlaps(
          currentSlotStart,
          currentSlotEnd,
          new Date(closure.starts_at),
          new Date(closure.ends_at)
        )
      );

      const conflictsWithAppointment = relevantAppointments.some((appointment) =>
        overlaps(
          currentSlotStart,
          currentSlotEnd,
          new Date(appointment.start_time),
          new Date(appointment.end_time)
        )
      );

      if (
        !conflictsWithBreak &&
        !conflictsWithClosure &&
        !conflictsWithAppointment
      ) {
        slots.push({
          startTime: currentSlotStart.toISOString(),
          endTime: currentSlotEnd.toISOString(),
          employeeId: employee.id,
        });
      }

      currentSlotStart = addMinutes(currentSlotStart, appointmentDuration);
    }
  }

  return {
    slots,
  };
}
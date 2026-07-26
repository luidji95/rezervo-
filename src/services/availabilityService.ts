import { supabase } from "@/lib/supabase/client";
import type {
  GenerateAvailableSlotsInput,
  GenerateAvailableSlotsResult,
} from "@/types/availability";
import {
  DEFAULT_SALON_TIME_ZONE,
  getDayOfWeekFromDateKey,
  getDayRangeUtc,
  getTodayDateKey,
  zonedDateTimeToUtc,
} from "@/lib/salonDateTime";
import {
  availabilityRangesOverlap,
  isSlotAllowedByCurrentTime,
} from "@/services/availabilitySlotCore";

type SupabaseClientLike = typeof supabase;

function combineDateAndTime(date: string, time: string, timeZone: string): Date {
  return zonedDateTimeToUtc(date, time, timeZone);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function shouldSkipPastSlot(
  slotStart: Date,
  selectedDate: string,
  timeZone: string,
): boolean {
  return !isSlotAllowedByCurrentTime({ slotStart, selectedDate, timeZone });
}

// =========================================================
// GLAVNA AVAILABILITY FUNKCIJA
// =========================================================
export async function generateAvailableSlots(
  input: GenerateAvailableSlotsInput & { excludeAppointmentId?: string },
  supabaseClient: SupabaseClientLike = supabase
): Promise<GenerateAvailableSlotsResult> {
  const { salonId, serviceId, employeeId, date, excludeAppointmentId } = input;

  const [salonRes, serviceRes, employeesRes] = await Promise.all([
    supabaseClient
      .from("salons")
      .select("id, timezone")
      .eq("id", salonId)
      .single(),
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
        id,
        employee_services!inner(
          service_id,
          salon_id,
          is_active,
          custom_duration_minutes
        )
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

  if (salonRes.error) throw new Error("Failed to fetch salon timezone.");
  const salonTimeZone = salonRes.data.timezone || DEFAULT_SALON_TIME_ZONE;
  const today = getTodayDateKey(salonTimeZone);

  if (date < today) {
    return { slots: [] };
  }

  if (serviceRes.error) {
    throw new Error(`Service query failed: ${serviceRes.error.message}`);
  }

  if (!serviceRes.data) {
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

  const dayOfWeek = getDayOfWeekFromDateKey(date);

  const compatibleEmployeeIds = compatibleEmployees.map((employee) => employee.id);

  const { startUtc: dayStart, endUtc: dayEnd } = getDayRangeUtc(
    date,
    salonTimeZone,
  );

  // Priprema dinamičkog upita za termine
  let appointmentsQuery = supabaseClient
    .from("appointments")
    .select("*")
    .eq("salon_id", salonId)
    .in("employee_id", compatibleEmployeeIds)
    .lt("start_time", dayEnd.toISOString())
    .gt("end_time", dayStart.toISOString())
    .not("status", "in", "(cancelled,no_show)");

  // AKO JE RESCHEDULE FLOW: Ignorišemo trenutni appointmentId da ne pravi konflikt sam sa sobom
  if (excludeAppointmentId) {
    appointmentsQuery = appointmentsQuery.neq("id", excludeAppointmentId);
  }

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

    appointmentsQuery,
  ]);

  if (workingHoursRes.error) throw new Error("Failed to fetch working hours.");
  if (closuresRes.error) throw new Error("Failed to fetch closures.");
  if (appointmentsRes.error) throw new Error("Failed to fetch appointments.");

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

    const workStart = combineDateAndTime(date, schedule.opens_at, salonTimeZone);
    const workEnd = combineDateAndTime(date, schedule.closes_at, salonTimeZone);

    const breakStart = schedule.break_starts_at
      ? combineDateAndTime(date, schedule.break_starts_at, salonTimeZone)
      : null;

    const breakEnd = schedule.break_ends_at
      ? combineDateAndTime(date, schedule.break_ends_at, salonTimeZone)
      : null;

    const relation = employee.employee_services?.[0];
    const appointmentDuration =
      (relation?.custom_duration_minutes ?? service.duration_minutes) +
      (service.buffer_minutes ?? 0);

    let currentSlotStart = workStart;

    while (true) {
      const currentSlotEnd = addMinutes(currentSlotStart, appointmentDuration);

      if (currentSlotEnd > workEnd) {
        break;
      }

      if (shouldSkipPastSlot(currentSlotStart, date, salonTimeZone)) {
        currentSlotStart = addMinutes(currentSlotStart, appointmentDuration);
        continue;
      }

      const conflictsWithBreak =
        breakStart &&
        breakEnd &&
        availabilityRangesOverlap(
          { start: currentSlotStart, end: currentSlotEnd },
          { start: breakStart, end: breakEnd },
        );

      const conflictsWithClosure = relevantClosures.some((closure) =>
        availabilityRangesOverlap(
          { start: currentSlotStart, end: currentSlotEnd },
          { start: new Date(closure.starts_at), end: new Date(closure.ends_at) },
        )
      );

      const conflictsWithAppointment = relevantAppointments.some((appointment) =>
        availabilityRangesOverlap(
          { start: currentSlotStart, end: currentSlotEnd },
          {
            start: new Date(appointment.start_time),
            end: new Date(appointment.end_time),
          },
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

      // Pomeramo petlju na sledeći potencijalni slot (ovde možeš promeniti korak na npr. 15 ili 30 min ako ne želiš koračanje celim trajanjem)
      currentSlotStart = addMinutes(currentSlotStart, appointmentDuration);
    }
  }

  return {
    slots,
  };
}

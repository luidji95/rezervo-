import { supabase } from "@/lib/supabase/client";

type ValidateAppointmentSlotInput = {
  salonId: string;
  employeeId: string;
  serviceId: string;
  startTime: string;
  endTime: string;
};

function getDayOfWeek(date: Date) {
  return date.getDay(); // 0 = Sunday, 1 = Monday...
}

function toTimeString(date: Date) {
  return date.toTimeString().slice(0, 5); // HH:mm
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
) {
  return startA < endB && endA > startB;
}

export async function validateAppointmentSlot({
  salonId,
  employeeId,
  serviceId,
  startTime,
  endTime,
}: ValidateAppointmentSlotInput) {
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid appointment time.");
  }

  if (startDate >= endDate) {
    throw new Error("Appointment start time must be before end time.");
  }

  const dayOfWeek = getDayOfWeek(startDate);
  const startClock = toTimeString(startDate);
  const endClock = toTimeString(endDate);

  const { data: employeeService, error: employeeServiceError } = await supabase
    .from("employee_services")
    .select("id")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId)
    .eq("service_id", serviceId)
    .eq("is_active", true)
    .maybeSingle();

  if (employeeServiceError) {
    throw new Error("Failed to validate employee service.");
  }

  if (!employeeService) {
    throw new Error("This employee does not provide the selected service.");
  }

  const { data: employeeWorkingHours, error: employeeHoursError } =
    await supabase
      .from("working_hours")
      .select("*")
      .eq("salon_id", salonId)
      .eq("employee_id", employeeId)
      .eq("day_of_week", dayOfWeek)
      .maybeSingle();

  if (employeeHoursError) {
    throw new Error("Failed to fetch employee working hours.");
  }

  let workingHours = employeeWorkingHours;

  if (!workingHours) {
    const { data: salonWorkingHours, error: salonHoursError } = await supabase
      .from("working_hours")
      .select("*")
      .eq("salon_id", salonId)
      .is("employee_id", null)
      .eq("day_of_week", dayOfWeek)
      .maybeSingle();

    if (salonHoursError) {
      throw new Error("Failed to fetch salon working hours.");
    }

    workingHours = salonWorkingHours;
  }

  if (!workingHours || !workingHours.is_working_day) {
    throw new Error("Employee is not working on this day.");
  }

  const appointmentStartMinutes = timeToMinutes(startClock);
  const appointmentEndMinutes = timeToMinutes(endClock);
  const openMinutes = timeToMinutes(workingHours.opens_at.slice(0, 5));
  const closeMinutes = timeToMinutes(workingHours.closes_at.slice(0, 5));

  if (
    appointmentStartMinutes < openMinutes ||
    appointmentEndMinutes > closeMinutes
  ) {
    throw new Error("Appointment is outside working hours.");
  }

  if (workingHours.break_starts_at && workingHours.break_ends_at) {
    const breakStart = workingHours.break_starts_at.slice(0, 5);
    const breakEnd = workingHours.break_ends_at.slice(0, 5);

    if (rangesOverlap(startClock, endClock, breakStart, breakEnd)) {
      throw new Error("Appointment overlaps with break time.");
    }
  }

  const { data: closures, error: closuresError } = await supabase
    .from("closures")
    .select("id")
    .eq("salon_id", salonId)
    .or(`employee_id.is.null,employee_id.eq.${employeeId}`)
    .lt("starts_at", endTime)
    .gt("ends_at", startTime);

  if (closuresError) {
    throw new Error("Failed to validate closures.");
  }

  if (closures && closures.length > 0) {
    throw new Error("Appointment overlaps with closure/time off.");
  }

  const { data: conflicts, error: conflictsError } = await supabase
    .from("appointments")
    .select("id")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId)
    .in("status", ["pending", "confirmed"])
    .lt("start_time", endTime)
    .gt("end_time", startTime);

  if (conflictsError) {
    throw new Error("Failed to validate appointment conflicts.");
  }

  if (conflicts && conflicts.length > 0) {
    throw new Error("This slot is no longer available.");
  }

  return true;
}
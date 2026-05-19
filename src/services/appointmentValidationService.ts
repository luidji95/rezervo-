import { supabase } from "@/lib/supabase/client";
import { generateAvailableSlots } from "@/services/availabilityService";

type SupabaseClientLike = typeof supabase;

type ValidateAppointmentSlotInput = {
  salonId: string;
  employeeId: string;
  serviceId: string;
  startTime: string;
  endTime: string;
  enforceGeneratedSlot?: boolean;
};

const SALON_TIMEZONE = "Europe/Belgrade";

function getDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format appointment date.");
  }

  return `${year}-${month}-${day}`;
}

export async function validateAppointmentSlot(
  {
    salonId,
    employeeId,
    serviceId,
    startTime,
    endTime,
    enforceGeneratedSlot = false,
  }: ValidateAppointmentSlotInput,
  supabaseClient: SupabaseClientLike = supabase
) {
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const now = new Date();

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid appointment time.");
  }

  if (startDate >= endDate) {
    throw new Error("Appointment start time must be before end time.");
  }

  if (startDate <= now) {
    throw new Error("Cannot book an appointment in the past.");
  }

  if (enforceGeneratedSlot) {
    const bookingDate = getDateInTimeZone(startDate, SALON_TIMEZONE);

    const availableSlots = await generateAvailableSlots(
      {
        salonId,
        employeeId,
        serviceId,
        date: bookingDate,
      },
      supabaseClient
    );

    const isValidGeneratedSlot = availableSlots.slots.some((slot) => {
      const slotStart = new Date(slot.startTime);

      return (
        slot.employeeId === employeeId &&
        slotStart.getTime() === startDate.getTime()
      );
    });

    if (!isValidGeneratedSlot) {
      throw new Error("Selected time is not a valid booking slot.");
    }

    return true;
  }

  const { data: conflicts, error: conflictsError } = await supabaseClient
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
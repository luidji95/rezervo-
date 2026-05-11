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

function getDateOnlyFromIso(isoValue: string) {
  return isoValue.slice(0, 10);
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

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid appointment time.");
  }

  if (startDate >= endDate) {
    throw new Error("Appointment start time must be before end time.");
  }

  if (enforceGeneratedSlot) {
    const availableSlots = await generateAvailableSlots(
      {
        salonId,
        employeeId,
        serviceId,
        date: getDateOnlyFromIso(startTime),
      },
      supabaseClient
    );

    const isValidGeneratedSlot = availableSlots.slots.some(
      (slot) => slot.employeeId === employeeId && slot.startTime === startTime
    );

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
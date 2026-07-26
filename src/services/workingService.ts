import { supabase } from "@/lib/supabase/client";
import type {
  CreateWorkingHourPayload,
  WorkingHour,
} from "@/types/workingHour";

export const WORKING_HOURS_CHANGED_EVENT = "rezervo:working-hours-changed";
export const WORKING_HOURS_VERSION_KEY = "rezervo:working-hours-version";

function notifyWorkingHoursChanged() {
  if (typeof window === "undefined") return;
  const version = Date.now().toString();
  window.localStorage.setItem(WORKING_HOURS_VERSION_KEY, version);
  window.dispatchEvent(new CustomEvent(WORKING_HOURS_CHANGED_EVENT, { detail: { version } }));
}

export async function getSalonWorkingHours(
  salonId: string
): Promise<WorkingHour[]> {
  const { data, error } = await supabase
    .from("working_hours")
    .select("*")
    .eq("salon_id", salonId)
    .is("employee_id", null)
    .order("day_of_week", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getEmployeeWorkingHours(
  salonId: string,
  employeeId: string
): Promise<WorkingHour[]> {
  const { data, error } = await supabase
    .from("working_hours")
    .select("*")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId)
    .order("day_of_week", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getAllWorkingHoursForSalon(
  salonId: string
): Promise<WorkingHour[]> {
  const { data, error } = await supabase
    .from("working_hours")
    .select("*")
    .eq("salon_id", salonId)
    .order("day_of_week", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function upsertWorkingHour(
  payload: CreateWorkingHourPayload
): Promise<WorkingHour> {
  let existingQuery = supabase
    .from("working_hours")
    .select("id")
    .eq("salon_id", payload.salon_id)
    .eq("day_of_week", payload.day_of_week);

  if (payload.employee_id) {
    existingQuery = existingQuery.eq("employee_id", payload.employee_id);
  } else {
    existingQuery = existingQuery.is("employee_id", null);
  }

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from("working_hours")
      .update({
        opens_at: payload.opens_at,
        closes_at: payload.closes_at,
        break_starts_at: payload.break_starts_at ?? null,
        break_ends_at: payload.break_ends_at ?? null,
        is_working_day: payload.is_working_day,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    notifyWorkingHoursChanged();
    return data;
  }

  const { data, error } = await supabase
    .from("working_hours")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  notifyWorkingHoursChanged();
  return data;
}

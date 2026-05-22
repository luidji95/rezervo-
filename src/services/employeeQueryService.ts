import { supabase } from "@/lib/supabase/client";

export type CalendarEmployee = {
  id: string;
  full_name: string;
  display_name: string | null;
  position: string | null;
};

export async function getCalendarEmployees(
  salonId: string
): Promise<CalendarEmployee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name, display_name, position")
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .eq("is_bookable", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
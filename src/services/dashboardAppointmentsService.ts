import { supabase } from "@/lib/supabase/client";
import {
  AppointmentListItem,
  getSalonAppointmentsByDate,
} from "@/services/appointmentQueryService";

export async function getTodaySchedule(
  salonId: string,
  date: string
): Promise<AppointmentListItem[]> {
  return getSalonAppointmentsByDate(salonId, date);
}

export async function getUpcomingAppointments(
  salonId: string,
  limit = 5
): Promise<AppointmentListItem[]> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      start_time,
      end_time,
      status,
      payment_status,
      booking_source,
      price,
      currency,
      customer_note,
      internal_note,
      clients ( id, full_name ),
      employees ( id, full_name, display_name ),
      services:primary_service_id ( id, name )
    `
    )
    .eq("salon_id", salonId)
    .neq("status", "cancelled")
    .gte("start_time", nowIso)
    .order("start_time", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AppointmentListItem[];
}

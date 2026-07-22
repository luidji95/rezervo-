import { supabase } from "@/lib/supabase/client";
import { getEmployeeAppointmentClients } from "@/services/employeeClientReadService";
import {
  DEFAULT_SALON_TIME_ZONE,
  getDayRangeUtc,
} from "@/lib/salonDateTime";
export type AppointmentListItem = {
  id: string;
  client_id?: string;
  start_time: string;
  end_time: string;
  status: string;

  payment_status: string | null;
  booking_source: string | null;
  price: number | null;
  currency: string | null;

  customer_note: string | null;
  internal_note: string | null;

  clients: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;

  employees: {
    id: string;
    full_name: string;
    display_name: string | null;
  } | null;

  services: {
    id: string;
    name: string;
    duration_minutes: number;
  } | null;
};

export async function getSalonAppointmentsByDate(
  salonId: string,
  date: string,
  timeZone = DEFAULT_SALON_TIME_ZONE,
): Promise<AppointmentListItem[]> {
  const { startUtc, endUtc } = getDayRangeUtc(date, timeZone);

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      client_id,
      start_time,
      end_time,
      status,
      payment_status,
      booking_source,
      price,
      currency,
      customer_note,
      internal_note,
      clients (
        id,
        full_name,
        phone,
        email
      ),
      employees (
        id,
        full_name,
        display_name
      ),
      services:primary_service_id (
        id,
        name,
        duration_minutes
      )
    `
    )
    .eq("salon_id", salonId)
    .gte("start_time", startUtc.toISOString())
    .lt("start_time", endUtc.toISOString())
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  const appointments = (data ?? []) as unknown as AppointmentListItem[];

  if (!appointments.some((appointment) => !appointment.clients)) {
    return appointments;
  }

  const employeeClients = await getEmployeeAppointmentClients(salonId);
  const clientsById = new Map(
    employeeClients.map((client) => [client.id, client]),
  );

  return appointments.map((appointment) => ({
    ...appointment,
    clients:
      appointment.clients ??
      (appointment.client_id
        ? clientsById.get(appointment.client_id) ?? null
        : null),
  }));
  
}

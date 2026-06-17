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
      clients ( id, full_name, phone, email ),
      employees ( id, full_name, display_name ),
      services:primary_service_id ( id, name, duration_minutes )
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

  const normalizeRelation = <T,>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? value[0] ?? null : value;

  return (data ?? []).map((appointment) => {
    const clients = normalizeRelation(appointment.clients);
    const employees = normalizeRelation(appointment.employees);
    const services = normalizeRelation(appointment.services);

    return {
      id: appointment.id,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
      status: appointment.status,
      payment_status: appointment.payment_status,
      booking_source: appointment.booking_source,
      price: appointment.price,
      currency: appointment.currency,
      customer_note: appointment.customer_note,
      internal_note: appointment.internal_note,
      clients: clients
        ? {
            id: clients.id,
            full_name: clients.full_name,
            phone: clients.phone ?? null,
            email: clients.email ?? null,
          }
        : null,
      employees: employees
        ? {
            id: employees.id,
            full_name: employees.full_name,
            display_name: employees.display_name ?? null,
          }
        : null,
      services: services
        ? {
            id: services.id,
            name: services.name,
            duration_minutes: services.duration_minutes ?? 0,
          }
        : null,
    };
  }) as AppointmentListItem[];
}

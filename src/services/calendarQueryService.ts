import { supabase } from "@/lib/supabase/client";

export type CalendarAppointment = {
  id: string;
  salon_id: string; // <-- DODATO: Tipiziran salon_id za lakši dohvat u modalima
  start_time: string;
  end_time: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;

  clients: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;

  services: {
    id: string;   // <-- DODATO: ID usluge je sada dostupan kroz tipove
    name: string;
  } | null;

  employees: {
    id: string;
    full_name: string;
    display_name: string | null;
  } | null;
};

export type ClientHistoryAppointment = {
  id: string;
  start_time: string;
  status: string;
  services: {
    name: string;
  } | null;
};

// =========================================================
// Upiti za kalendar (Fetch functions)
// =========================================================

/**
 * Dobavlja sve termine za određeni salon i izabrani datum.
 */
export async function getCalendarAppointments(
  salonId: string,
  date: string
): Promise<CalendarAppointment[]> {
  const startOfDay = new Date(`${date}T00:00:00`);
  const endOfDay = new Date(`${date}T23:59:59`);

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      salon_id,              
      start_time,
      end_time,
      status,
      customer_note, 
      internal_note,

      clients (
        id,
        full_name,
        phone,
        email
      ),

      services:primary_service_id (
        id,                 
        name
      ),

      employees (
        id,
        full_name,
        display_name
      )
    `
    )
    .eq("salon_id", salonId)
    .gte("start_time", startOfDay.toISOString())
    .lte("start_time", endOfDay.toISOString())
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as CalendarAppointment[];
}

/**
 * Dobavlja kompletnu istoriju termina za klijenta, isključujući trenutni termin.
 */
export async function getClientAppointmentHistory(
  clientId: string,
  currentAppointmentId: string
): Promise<ClientHistoryAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(`
      id,
      start_time,
      status,
      services:primary_service_id (
        name
      )
    `)
    .eq("client_id", clientId)
    .neq("id", currentAppointmentId)
    .lt("start_time", new Date().toISOString())
    .order("start_time", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as ClientHistoryAppointment[];
}

// =========================================================
// Operativne akcije (Ažuriranje i Reschedule)
// =========================================================

/**
 * Ažurira status termina u bazi podataka na osnovu stabilnih engleskih vrednosti.
 * @param appointmentId ID rezervacije koju menjamo
 * @param status Nova vrednost statusa ('confirmed', 'completed', 'cancelled', 'pending', 'no_show')
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  status: "confirmed" | "completed" | "cancelled" | "pending" | "no_show"
) {
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

/**
 * Pomera termin na novo vreme/datum i opciono dodeljuje drugom zaposlenom.
 * Rešena explicit-any greška korišćenjem strogog Record tipa.
 */
export async function updateAppointmentTime(
  appointmentId: string,
  startTime: string,
  endTime: string,
  employeeId?: string
) {
  const updateData: Record<string, string> = {
    start_time: startTime,
    end_time: endTime,
    status: "confirmed"
  };

  if (employeeId) {
    updateData.employee_id = employeeId;
  }

  const { data, error } = await supabase
    .from("appointments")
    .update(updateData)
    .eq("id", appointmentId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

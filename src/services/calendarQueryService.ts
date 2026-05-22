import { supabase } from "@/lib/supabase/client";

export type CalendarAppointment = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  customer_notes: string | null; // <-- DODATO
  internal_note: string | null; // dodato

  clients: {
    id: string; // <-- Dodajemo ID klijenta da bismo u budućnosti mogli da vučemo istoriju
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;

  services: {
    name: string;
  } | null;

  employees: {
    id: string;
    full_name: string;
    display_name: string | null;
  } | null;
};

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

// Dodaj na dno fajla: src/services/calendarQueryService.ts

export type ClientHistoryAppointment = {
  id: string;
  start_time: string;
  status: string;
  services: {
    name: string;
  } | null;
};

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
    .neq("id", currentAppointmentId) // Izuzimamo trenutni termin koji gledamo
    .lt("start_time", new Date().toISOString()) // Gledamo samo prošle termine
    .order("start_time", { ascending: false }) // Najnoviji ide prvi
    .limit(3); // Uzimamo maksimalno 3 komada

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as ClientHistoryAppointment[];
}
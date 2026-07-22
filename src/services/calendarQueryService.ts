import { supabase } from "@/lib/supabase/client";
import {
  createNotification,
  formatNotificationAppointmentTime,
  type NotificationType,
} from "@/services/notificationService";

const CALENDAR_APPOINTMENT_SELECT = `
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
`;

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
    .select(CALENDAR_APPOINTMENT_SELECT)
    .eq("salon_id", salonId)
    .gte("start_time", startOfDay.toISOString())
    .lte("start_time", endOfDay.toISOString())
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as CalendarAppointment[];
}

export async function getCalendarAppointmentById(
  salonId: string,
  appointmentId: string
): Promise<CalendarAppointment> {
  const { data, error } = await supabase
    .from("appointments")
    .select(CALENDAR_APPOINTMENT_SELECT)
    .eq("salon_id", salonId)
    .eq("id", appointmentId)
    .single();

  if (error) throw new Error(error.message);

  return data as unknown as CalendarAppointment;
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
export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

const allowedStatusTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ["confirmed", "completed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function updateAppointmentStatus({
  appointmentId,
  salonId,
  nextStatus,
}: {
  appointmentId: string;
  salonId: string;
  nextStatus: AppointmentStatus;
}) {
  const { data: currentAppointment, error: currentError } = await supabase
    .from("appointments")
    .select("id, status")
    .eq("id", appointmentId)
    .eq("salon_id", salonId)
    .maybeSingle();

  if (currentError) {
    throw new Error(currentError.message);
  }

  if (!currentAppointment) {
    throw new Error("Appointment not found in the current salon.");
  }

  const currentStatus = currentAppointment.status as AppointmentStatus;

  if (currentStatus === nextStatus) {
    return currentAppointment;
  }

  if (!allowedStatusTransitions[currentStatus]?.includes(nextStatus)) {
    throw new Error(
      `Invalid appointment status transition: ${currentStatus} -> ${nextStatus}.`
    );
  }

  const { data, error } = await supabase
    .from("appointments")
    .update({ status: nextStatus })
    .eq("id", appointmentId)
    .eq("salon_id", salonId)
    .eq("status", currentStatus)
    .select(`
      id,
      salon_id,
      start_time,
      clients (full_name),
      services:primary_service_id (name)
    `)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const appointment = data as unknown as {
    id: string;
    salon_id: string;
    start_time: string;
    clients: { full_name: string } | null;
    services: { name: string } | null;
  };

  const notificationByStatus: Partial<
    Record<
      AppointmentStatus,
      { type: NotificationType; title: string; action: string }
    >
  > = {
    confirmed: {
      type: "appointment_confirmed",
      title: "Termin potvrđen",
      action: "potvrđen",
    },
    completed: {
      type: "appointment_completed",
      title: "Termin završen",
      action: "završen",
    },
    cancelled: {
      type: "appointment_cancelled",
      title: "Termin otkazan",
      action: "otkazan",
    },
    no_show: {
      type: "appointment_no_show",
      title: "Klijent se nije pojavio",
      action: "označen kao nedolazak",
    },
  };

  const notification = notificationByStatus[nextStatus];

  if (notification) {
    await createNotification({
      salonId: appointment.salon_id,
      type: notification.type,
      title: notification.title,
      message: `${appointment.clients?.full_name || "Klijent"} – ${appointment.services?.name || "usluga"}: termin je ${notification.action} (${formatNotificationAppointmentTime(appointment.start_time)})`,
      entityType: "appointment",
      entityId: appointment.id,
    });
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("rezervo:appointment-status-changed"));
    window.localStorage.setItem(
      "rezervo:appointments-version",
      Date.now().toString()
    );
  }

  return appointment;
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

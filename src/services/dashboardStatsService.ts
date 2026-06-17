import { supabase } from "@/lib/supabase/client";
import { getAllWorkingHoursForSalon } from "@/services/workingService";
import { getSalonEmployees } from "@/services/employeeService";
import type { AppointmentListItem } from "@/services/appointmentQueryService";

export type DashboardStats = {
  todayAppointments: number;
  occupancyToday: number;
  nextAppointment: AppointmentListItem | null;
  monthlyRevenue: number;
  monthlyNewClients: number;
  monthlyAppointments: number;
};

function getStartOfDay(date: Date) {
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function getEndOfDay(date: Date) {
  const clone = new Date(date);
  clone.setHours(23, 59, 59, 999);
  return clone;
}

function getMonthBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function toMinutes(timestamp: string | null | undefined) {
  if (!timestamp) {
    return 0;
  }

  const [hours, minutes] = timestamp.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function getWorkingMinutes(hours: { opens_at: string; closes_at: string; break_starts_at: string | null; break_ends_at: string | null; is_working_day: boolean; }) {
  if (!hours.is_working_day) {
    return 0;
  }

  const open = toMinutes(hours.opens_at);
  const close = toMinutes(hours.closes_at);
  const breakStart = toMinutes(hours.break_starts_at);
  const breakEnd = toMinutes(hours.break_ends_at);

  const total = Math.max(close - open, 0);
  const breakTime = Math.max(breakEnd - breakStart, 0);

  return Math.max(total - breakTime, 0);
}

export async function getDashboardStats(salonId: string): Promise<DashboardStats> {
  const today = new Date();
  const { start: todayStart, end: todayEnd } = {
    start: getStartOfDay(today),
    end: getEndOfDay(today),
  };
  const { start: monthStart, end: monthEnd } = getMonthBounds(today);
  const nowIso = new Date().toISOString();

  const [todayAppointmentsRes, revenueRes, nextAppointmentRes, clientsRes, employees, workingHours] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("duration_minutes, start_time, end_time", { count: "exact" })
        .eq("salon_id", salonId)
        .gte("start_time", todayStart.toISOString())
        .lte("start_time", todayEnd.toISOString()),
      supabase
        .from("appointments")
        .select("price, currency")
        .eq("salon_id", salonId)
        .eq("status", "completed")
        .gte("start_time", monthStart.toISOString())
        .lte("start_time", monthEnd.toISOString()),
      supabase
        .from("appointments")
        .select(
          `
            id,
            start_time,
            end_time,
            status,
            price,
            currency,
            clients ( id, full_name ),
            employees ( id, full_name, display_name ),
            services:primary_service_id ( id, name )
          `
        )
        .eq("salon_id", salonId)
        .neq("status", "cancelled")
        .gte("start_time", nowIso)
        .order("start_time", { ascending: true })
        .limit(1),
      supabase
        .from("clients")
        .select("id", { count: "exact" })
        .eq("salon_id", salonId)
        .gte("created_at", monthStart.toISOString())
        .lte("created_at", monthEnd.toISOString()),
      getSalonEmployees(salonId),
      getAllWorkingHoursForSalon(salonId),
    ]);

  if (todayAppointmentsRes.error) {
    throw new Error(todayAppointmentsRes.error.message);
  }

  if (revenueRes.error) {
    throw new Error(revenueRes.error.message);
  }

  if (nextAppointmentRes.error) {
    throw new Error(nextAppointmentRes.error.message);
  }

  if (clientsRes.error) {
    throw new Error(clientsRes.error.message);
  }

  const appointmentRows = todayAppointmentsRes.data ?? [];
  const todayAppointments = todayAppointmentsRes.count ?? appointmentRows.length;

  const occupiedMinutes = appointmentRows.reduce((sum, appointment) => {
    const minutes = typeof appointment.duration_minutes === "number"
      ? appointment.duration_minutes
      : appointment.start_time && appointment.end_time
      ? (new Date(appointment.end_time).getTime() - new Date(appointment.start_time).getTime()) / 60000
      : 0;

    return sum + Math.max(minutes, 0);
  }, 0);

  const dayOfWeek = today.getDay();
  const salonDefaultHours = workingHours.find(
    (hour) => hour.employee_id === null && hour.day_of_week === dayOfWeek
  );

  const totalAvailableMinutes = employees.reduce((total, employee) => {
    const employeeHours = workingHours.find(
      (hour) => hour.employee_id === employee.id && hour.day_of_week === dayOfWeek
    );

    const effectiveHours = employeeHours ?? salonDefaultHours;

    return total + (effectiveHours ? getWorkingMinutes(effectiveHours) : 0);
  }, 0);

  const occupancyToday = totalAvailableMinutes > 0
    ? Math.round((occupiedMinutes / totalAvailableMinutes) * 100)
    : 0;

  const monthlyRevenue = (revenueRes.data ?? []).reduce(
    (sum, appointment) => sum + (appointment.price ?? 0),
    0
  );

  const monthlyAppointments = (revenueRes.data ?? []).length;
  const monthlyNewClients = clientsRes.count ?? 0;

  return {
    todayAppointments,
    occupancyToday,
    nextAppointment: (nextAppointmentRes.data ?? [])[0] ?? null,
    monthlyRevenue,
    monthlyNewClients,
    monthlyAppointments,
  };
}

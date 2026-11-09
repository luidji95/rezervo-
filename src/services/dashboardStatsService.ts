import { supabase } from "@/lib/supabase/client";
import type { AppointmentListItem } from "@/services/appointmentQueryService";
import {
  DEFAULT_SALON_TIME_ZONE,
  getDayRangeUtc,
  getTodayDateKey,
} from "@/lib/salonDateTime";
import {
  computeTodayOccupancy,
  DASHBOARD_COUNTED_STATUSES,
  getMonthRangeUtc,
  type TodayOccupancy,
} from "@/features/dashboard/services/dashboardMetricsCore";

export type DashboardStats = {
  todayAppointments: number;
  nextAppointment: AppointmentListItem | null;
  monthlyRevenue: number;
  monthlyNewClients: number;
  monthlyAppointments: number;
};

type RelationValue<T> = T | T[] | null;

type AppointmentRelationClient = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
};

type AppointmentRelationEmployee = {
  id: string;
  full_name: string;
  display_name: string | null;
};

type AppointmentRelationService = {
  id: string;
  name: string;
  duration_minutes: number | null;
};

type RawAppointment = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  payment_status: string | null;
  booking_source: string | null;
  price: number | null;
  currency: string | null;
  customer_note: string | null;
  internal_note: string | null;
  clients: RelationValue<AppointmentRelationClient>;
  employees: RelationValue<AppointmentRelationEmployee>;
  services: RelationValue<AppointmentRelationService>;
};

function normalizeRelation<T>(value: RelationValue<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeAppointment(appointment: RawAppointment): AppointmentListItem {
  const client = normalizeRelation(appointment.clients);
  const employee = normalizeRelation(appointment.employees);
  const service = normalizeRelation(appointment.services);

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
    clients: client
      ? {
          id: client.id,
          full_name: client.full_name,
          phone: client.phone,
          email: client.email,
        }
      : null,
    employees: employee
      ? {
          id: employee.id,
          full_name: employee.full_name,
          display_name: employee.display_name,
        }
      : null,
    services: service
      ? {
          id: service.id,
          name: service.name,
          duration_minutes: service.duration_minutes ?? 0,
        }
      : null,
  };
}

// Today's appointments (pending, confirmed, completed) and this month's figures, both in the salon's time zone.
// Any failed query throws: the Dashboard shows the section as unavailable instead of zeros.
export async function getDashboardStats(
  salonId: string,
  timeZone = DEFAULT_SALON_TIME_ZONE,
): Promise<DashboardStats> {
  const now = new Date();
  const todayDateKey = getTodayDateKey(timeZone, now);
  const { startUtc: todayStart, endUtc: todayEnd } = getDayRangeUtc(todayDateKey, timeZone);
  const { startUtc: monthStart, endUtc: monthEnd } = getMonthRangeUtc(todayDateKey, timeZone);

  const [todayAppointmentsRes, revenueRes, nextAppointmentRes, clientsRes] = await Promise.all([
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("salon_id", salonId)
      .in("status", [...DASHBOARD_COUNTED_STATUSES])
      .gte("start_time", todayStart.toISOString())
      .lt("start_time", todayEnd.toISOString()),

    supabase
      .from("appointments")
      .select("price, currency")
      .eq("salon_id", salonId)
      .eq("status", "completed")
      .gte("start_time", monthStart.toISOString())
      .lt("start_time", monthEnd.toISOString()),

    supabase
      .from("appointments")
      .select(`
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
      `)
      .eq("salon_id", salonId)
      .in("status", ["pending", "confirmed"])
      .gte("start_time", now.toISOString())
      .order("start_time", { ascending: true })
      .limit(1),

    // Client records created this month (shown as "Novi kartoni klijenata ovog meseca").
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("salon_id", salonId)
      .gte("created_at", monthStart.toISOString())
      .lt("created_at", monthEnd.toISOString()),
  ]);

  for (const result of [todayAppointmentsRes, revenueRes, nextAppointmentRes, clientsRes]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (todayAppointmentsRes.count === null || clientsRes.count === null) throw new Error("DASHBOARD_COUNT_UNAVAILABLE");

  const revenueRows = revenueRes.data ?? [];
  const rawNextAppointment = (nextAppointmentRes.data ?? [])[0] as RawAppointment | undefined;

  return {
    todayAppointments: todayAppointmentsRes.count,
    nextAppointment: rawNextAppointment ? normalizeAppointment(rawNextAppointment) : null,
    monthlyRevenue: revenueRows.reduce((sum, appointment) => sum + Number(appointment.price ?? 0), 0),
    monthlyNewClients: clientsRes.count,
    monthlyAppointments: revenueRows.length,
  };
}

// Occupancy of active, bookable employees today; see computeTodayOccupancy for the formula.
export async function getTodayOccupancy(
  salonId: string,
  timeZone = DEFAULT_SALON_TIME_ZONE,
): Promise<TodayOccupancy> {
  const dateKey = getTodayDateKey(timeZone);
  const { startUtc, endUtc } = getDayRangeUtc(dateKey, timeZone);
  const [employeesRes, hoursRes, closuresRes, appointmentsRes] = await Promise.all([
    supabase.from("employees").select("id, is_active, is_bookable").eq("salon_id", salonId),
    supabase.from("working_hours")
      .select("employee_id, day_of_week, opens_at, closes_at, break_starts_at, break_ends_at, is_working_day")
      .eq("salon_id", salonId),
    supabase.from("closures")
      .select("employee_id, starts_at, ends_at")
      .eq("salon_id", salonId)
      .lt("starts_at", endUtc.toISOString())
      .gt("ends_at", startUtc.toISOString()),
    supabase.from("appointments")
      .select("employee_id, start_time, end_time, status")
      .eq("salon_id", salonId)
      .in("status", [...DASHBOARD_COUNTED_STATUSES])
      .lt("start_time", endUtc.toISOString())
      .gt("end_time", startUtc.toISOString()),
  ]);
  for (const result of [employeesRes, hoursRes, closuresRes, appointmentsRes]) {
    if (result.error) throw new Error(result.error.message);
  }
  return computeTodayOccupancy({
    dateKey,
    timeZone,
    employees: employeesRes.data ?? [],
    workingHours: hoursRes.data ?? [],
    closures: closuresRes.data ?? [],
    appointments: appointmentsRes.data ?? [],
  });
}

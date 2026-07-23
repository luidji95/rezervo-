import { supabase } from "@/lib/supabase/client";
import { getDayRangeUtc } from "@/lib/salonDateTime";
import { getEmployeeAppointmentClients } from "@/services/employeeClientReadService";

import type { AppointmentListItem } from "@/services/appointmentQueryService";
import type { EmployeeAppointmentCurrentStatus } from "../employeeAppointmentStatusTransitions";

export const EMPLOYEE_APPOINTMENTS_PAGE_SIZE = 20;

export type EmployeeAppointmentsPeriod = "upcoming" | "today" | "history" | "custom";

export type EmployeeAppointmentsFilters = {
  period: EmployeeAppointmentsPeriod;
  status: "all" | EmployeeAppointmentCurrentStatus;
  search: string;
  fromDate: string;
  toDate: string;
  page: number;
};

export type EmployeeAppointmentsPageResult = {
  appointments: AppointmentListItem[];
  total: number;
};

const APPOINTMENT_SELECT = `
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
  clients(id, full_name, phone, email),
  employees(id, full_name, display_name),
  services:primary_service_id(id, name, duration_minutes)
`;

export async function getEmployeeAppointmentsPage(input: {
  salonId: string;
  employeeId: string;
  timeZone: string;
  todayKey: string;
  filters: EmployeeAppointmentsFilters;
}): Promise<EmployeeAppointmentsPageResult> {
  const clients = await getEmployeeAppointmentClients(input.salonId);
  const normalizedSearch = input.filters.search.trim().toLocaleLowerCase("sr");
  const matchingClientIds = normalizedSearch
    ? clients
        .filter((client) => client.full_name.toLocaleLowerCase("sr").includes(normalizedSearch))
        .map((client) => client.id)
    : [];

  if (normalizedSearch && matchingClientIds.length === 0) {
    return { appointments: [], total: 0 };
  }

  let query = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT, { count: "exact" })
    .eq("salon_id", input.salonId)
    .eq("employee_id", input.employeeId);

  const todayRange = getDayRangeUtc(input.todayKey, input.timeZone);
  if (input.filters.period === "upcoming") {
    query = query.gte("start_time", todayRange.startUtc.toISOString());
  } else if (input.filters.period === "today") {
    query = query
      .gte("start_time", todayRange.startUtc.toISOString())
      .lt("start_time", todayRange.endUtc.toISOString());
  } else if (input.filters.period === "history") {
    query = query.lt("start_time", todayRange.startUtc.toISOString());
  } else {
    const fromRange = getDayRangeUtc(input.filters.fromDate, input.timeZone);
    const toRange = getDayRangeUtc(input.filters.toDate, input.timeZone);
    query = query
      .gte("start_time", fromRange.startUtc.toISOString())
      .lt("start_time", toRange.endUtc.toISOString());
  }

  if (input.filters.status !== "all") query = query.eq("status", input.filters.status);
  if (matchingClientIds.length > 0) query = query.in("client_id", matchingClientIds);

  const start = input.filters.page * EMPLOYEE_APPOINTMENTS_PAGE_SIZE;
  const end = start + EMPLOYEE_APPOINTMENTS_PAGE_SIZE - 1;
  const ascending = input.filters.period !== "history";
  const { data, error, count } = await query
    .order("start_time", { ascending })
    .range(start, end);

  if (error) throw new Error(error.message);

  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const appointments = ((data ?? []) as unknown as AppointmentListItem[]).map((appointment) => ({
    ...appointment,
    clients: appointment.clients ?? (appointment.client_id ? clientsById.get(appointment.client_id) ?? null : null),
  }));
  return { appointments, total: count ?? appointments.length };
}

export async function getEmployeeAppointmentsKpis(input: {
  salonId: string;
  employeeId: string;
  todayKey: string;
  weekStartKey: string;
  weekEndKey: string;
  timeZone: string;
}) {
  const today = getDayRangeUtc(input.todayKey, input.timeZone);
  const weekStart = getDayRangeUtc(input.weekStartKey, input.timeZone).startUtc;
  const weekEnd = getDayRangeUtc(input.weekEndKey, input.timeZone).startUtc;
  const now = new Date().toISOString();
  const base = () => supabase.from("appointments").select("id", { count: "exact", head: true }).eq("salon_id", input.salonId).eq("employee_id", input.employeeId);
  const [todayResult, upcomingResult, completedResult, noShowResult] = await Promise.all([
    base().gte("start_time", today.startUtc.toISOString()).lt("start_time", today.endUtc.toISOString()).neq("status", "cancelled"),
    base().gte("start_time", now).in("status", ["pending", "confirmed"]),
    base().eq("status", "completed").gte("start_time", weekStart.toISOString()).lt("start_time", weekEnd.toISOString()),
    base().eq("status", "no_show").gte("start_time", weekStart.toISOString()).lt("start_time", weekEnd.toISOString()),
  ]);
  const error = [todayResult, upcomingResult, completedResult, noShowResult].find((result) => result.error)?.error;
  if (error) throw new Error(error.message);
  return {
    today: todayResult.count ?? 0,
    upcoming: upcomingResult.count ?? 0,
    completedThisWeek: completedResult.count ?? 0,
    noShowThisWeek: noShowResult.count ?? 0,
  };
}

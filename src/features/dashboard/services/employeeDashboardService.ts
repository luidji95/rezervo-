import { supabase } from "@/lib/supabase/client";
import {
  addDaysToDateKey,
  getDayOfWeekFromDateKey,
  getDayRangeUtc,
} from "@/lib/salonDateTime";
import { getEmployeeAppointmentClients } from "@/services/employeeClientReadService";

export type EmployeeDashboardAppointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  client: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
  } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
};

export type EmployeeWeekKpis = {
  completed: number;
  confirmed: number;
  noShow: number;
  total: number;
};

export type EmployeeTodayWorkingSchedule = {
  isWorkingDay: boolean;
  opensAt: string | null;
  closesAt: string | null;
  breakStartsAt: string | null;
  breakEndsAt: string | null;
  usesSalonDefault: boolean;
  closures: Array<{ id: string; title: string; startsAt: string; endsAt: string }>;
};

type RawAppointment = {
  id: string;
  client_id: string;
  start_time: string;
  end_time: string;
  status: string;
  clients: unknown;
  services: unknown;
};

function firstRelation<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

async function normalizeAppointments(
  salonId: string,
  rows: RawAppointment[],
): Promise<EmployeeDashboardAppointment[]> {
  const missingClient = rows.some((row) => !firstRelation(row.clients));
  const fallbackClients = missingClient
    ? await getEmployeeAppointmentClients(salonId).catch(() => [])
    : [];
  const clientsById = new Map(fallbackClients.map((client) => [client.id, client]));

  return rows.map((row) => {
    const embeddedClient = firstRelation<{
      id: string;
      full_name: string;
      phone: string | null;
      email: string | null;
    }>(row.clients);
    const client = embeddedClient ?? clientsById.get(row.client_id) ?? null;
    const service = firstRelation<{
      id: string;
      name: string;
      duration_minutes: number;
    }>(row.services);
    return {
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      client: client
        ? {
            id: client.id,
            fullName: client.full_name,
            phone: client.phone,
            email: client.email,
          }
        : null,
      service: service
        ? {
            id: service.id,
            name: service.name,
            durationMinutes: service.duration_minutes,
          }
        : null,
    };
  });
}

const APPOINTMENT_SELECT = `
  id,
  client_id,
  start_time,
  end_time,
  status,
  clients(id, full_name, phone, email),
  services:primary_service_id(id, name, duration_minutes)
`;

export async function getEmployeeTodayAppointments(input: {
  salonId: string;
  employeeId: string;
  dateKey: string;
  timeZone: string;
}) {
  const { startUtc, endUtc } = getDayRangeUtc(input.dateKey, input.timeZone);
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("salon_id", input.salonId)
    .eq("employee_id", input.employeeId)
    .in("status", ["pending", "confirmed", "completed", "no_show"])
    .gte("start_time", startUtc.toISOString())
    .lt("start_time", endUtc.toISOString())
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  return normalizeAppointments(input.salonId, (data ?? []) as unknown as RawAppointment[]);
}

export async function getEmployeeNextAppointment(input: {
  salonId: string;
  employeeId: string;
}) {
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("salon_id", input.salonId)
    .eq("employee_id", input.employeeId)
    .in("status", ["pending", "confirmed"])
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const normalized = await normalizeAppointments(
    input.salonId,
    (data ?? []) as unknown as RawAppointment[],
  );
  return normalized[0] ?? null;
}

export async function getEmployeeWeekKpis(input: {
  salonId: string;
  employeeId: string;
  dateKey: string;
  timeZone: string;
}): Promise<EmployeeWeekKpis> {
  const dayOfWeek = getDayOfWeekFromDateKey(input.dateKey);
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStartKey = addDaysToDateKey(input.dateKey, mondayOffset);
  const weekEndKey = addDaysToDateKey(weekStartKey, 7);
  const weekStart = getDayRangeUtc(weekStartKey, input.timeZone).startUtc;
  const weekEnd = getDayRangeUtc(weekEndKey, input.timeZone).startUtc;
  const { data, error } = await supabase
    .from("appointments")
    .select("status")
    .eq("salon_id", input.salonId)
    .eq("employee_id", input.employeeId)
    .in("status", ["completed", "confirmed", "no_show"])
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString());
  if (error) throw new Error(error.message);
  const statuses = data ?? [];
  return {
    completed: statuses.filter((row) => row.status === "completed").length,
    confirmed: statuses.filter((row) => row.status === "confirmed").length,
    noShow: statuses.filter((row) => row.status === "no_show").length,
    total: statuses.length,
  };
}

export async function getEmployeeTodayWorkingSchedule(input: {
  salonId: string;
  employeeId: string;
  dateKey: string;
  timeZone: string;
}): Promise<EmployeeTodayWorkingSchedule> {
  const dayOfWeek = getDayOfWeekFromDateKey(input.dateKey);
  const { startUtc, endUtc } = getDayRangeUtc(input.dateKey, input.timeZone);
  const [hoursResult, closuresResult] = await Promise.all([
    supabase
      .from("working_hours")
      .select("employee_id, opens_at, closes_at, break_starts_at, break_ends_at, is_working_day")
      .eq("salon_id", input.salonId)
      .eq("day_of_week", dayOfWeek)
      .or(`employee_id.eq.${input.employeeId},employee_id.is.null`),
    supabase
      .from("closures")
      .select("id, title, starts_at, ends_at, employee_id")
      .eq("salon_id", input.salonId)
      .lt("starts_at", endUtc.toISOString())
      .gt("ends_at", startUtc.toISOString())
      .or(`employee_id.eq.${input.employeeId},employee_id.is.null`),
  ]);
  if (hoursResult.error) throw new Error(hoursResult.error.message);
  if (closuresResult.error) throw new Error(closuresResult.error.message);

  const ownHours = hoursResult.data?.find((row) => row.employee_id === input.employeeId);
  const salonHours = hoursResult.data?.find((row) => row.employee_id === null);
  const hours = ownHours ?? salonHours ?? null;
  return {
    isWorkingDay: Boolean(hours?.is_working_day),
    opensAt: hours?.opens_at ?? null,
    closesAt: hours?.closes_at ?? null,
    breakStartsAt: hours?.break_starts_at ?? null,
    breakEndsAt: hours?.break_ends_at ?? null,
    usesSalonDefault: !ownHours && Boolean(salonHours),
    closures: (closuresResult.data ?? []).map((closure) => ({
      id: closure.id,
      title: closure.title,
      startsAt: closure.starts_at,
      endsAt: closure.ends_at,
    })),
  };
}

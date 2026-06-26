import { supabase } from "@/lib/supabase/client";
import type { Employee } from "@/types/employee";
import type { WorkingHour } from "@/types/workingHour";

export type EmployeeStats = {
  totalAppointments: number;
  completedAppointments: number;
  revenue: number;
  newClients: number;
  returningClients: number;
  occupancy: number;
  lastAppointmentAt: string | null;
  averageAppointmentValue: number;
};

export type EmployeeKPIs = {
  totalEmployees: number;
  activeToday: number;
  totalRevenue: number;
  averageOccupancy: number;
};

export type EmployeeAnalytics = {
  kpis: EmployeeKPIs;
  statsByEmployeeId: Record<string, EmployeeStats>;
};

export type EmployeeAppointmentAnalyticsRow = {
  id: string;
  employee_id: string | null;
  client_id: string | null;
  status: string;
  price: number | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
};

const REVENUE_STATUS = "completed";
const OCCUPANCY_EXCLUDED_STATUSES = new Set(["cancelled", "no_show"]);
const SALON_TIMEZONE = "Europe/Belgrade";

export function createEmptyEmployeeStats(): EmployeeStats {
  return {
    totalAppointments: 0,
    completedAppointments: 0,
    revenue: 0,
    newClients: 0,
    returningClients: 0,
    occupancy: 0,
    lastAppointmentAt: null,
    averageAppointmentValue: 0,
  };
}

function getDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SALON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getMinutesFromTime(value: string | null | undefined) {
  if (!value) return 0;

  const [hours = "0", minutes = "0"] = value.split(":");

  return Number(hours) * 60 + Number(minutes);
}

function getAppointmentDurationMinutes(appointment: EmployeeAppointmentAnalyticsRow) {
  if (appointment.duration_minutes && appointment.duration_minutes > 0) {
    return appointment.duration_minutes;
  }

  const start = new Date(appointment.start_time).getTime();
  const end = new Date(appointment.end_time).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }

  return Math.round((end - start) / 60000);
}

function getWorkingMinutesForDay(hour?: WorkingHour) {
  if (!hour?.is_working_day) {
    return 0;
  }

  const opensAt = getMinutesFromTime(hour.opens_at);
  const closesAt = getMinutesFromTime(hour.closes_at);
  const breakStartsAt = getMinutesFromTime(hour.break_starts_at);
  const breakEndsAt = getMinutesFromTime(hour.break_ends_at);
  const grossMinutes = Math.max(0, closesAt - opensAt);
  const breakMinutes =
    breakStartsAt > 0 && breakEndsAt > breakStartsAt
      ? breakEndsAt - breakStartsAt
      : 0;

  return Math.max(0, grossMinutes - breakMinutes);
}

function buildWorkingHourLookup(workingHours: WorkingHour[]) {
  const employeeHours = new Map<string, Map<number, WorkingHour>>();
  const salonHours = new Map<number, WorkingHour>();

  workingHours.forEach((hour) => {
    if (hour.employee_id) {
      const current = employeeHours.get(hour.employee_id) ?? new Map<number, WorkingHour>();
      current.set(hour.day_of_week, hour);
      employeeHours.set(hour.employee_id, current);
      return;
    }

    salonHours.set(hour.day_of_week, hour);
  });

  return { employeeHours, salonHours };
}

function getWorkingHourForDate(
  employeeId: string,
  dateKey: string,
  workingHours: WorkingHour[]
) {
  const { employeeHours, salonHours } = buildWorkingHourLookup(workingHours);
  const dayOfWeek = new Date(`${dateKey}T12:00:00`).getDay();

  return employeeHours.get(employeeId)?.get(dayOfWeek) ?? salonHours.get(dayOfWeek);
}

export function calculateEmployeeOccupancy(
  employeeId: string,
  appointments: EmployeeAppointmentAnalyticsRow[],
  workingHours: WorkingHour[]
) {
  const relevantAppointments = appointments.filter(
    (appointment) =>
      appointment.employee_id === employeeId &&
      !OCCUPANCY_EXCLUDED_STATUSES.has(appointment.status)
  );

  if (relevantAppointments.length === 0) {
    return 0;
  }

  const bookedMinutes = relevantAppointments.reduce(
    (sum, appointment) => sum + getAppointmentDurationMinutes(appointment),
    0
  );
  const appointmentDates = new Set(
    relevantAppointments.map((appointment) => getDateKey(appointment.start_time))
  );
  const availableMinutes = [...appointmentDates].reduce((sum, dateKey) => {
    const workingHour = getWorkingHourForDate(employeeId, dateKey, workingHours);

    return sum + getWorkingMinutesForDay(workingHour);
  }, 0);

  // Future improvement: include calendar closures, vacations and an explicit reporting
  // period. For now, occupancy is based on working_hours for dates that have bookings.
  if (availableMinutes <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100));
}

export function getEmployeeKPIs(
  employees: Employee[],
  statsByEmployeeId: Record<string, EmployeeStats>,
  appointments: EmployeeAppointmentAnalyticsRow[]
): EmployeeKPIs {
  const todayKey = getDateKey(new Date());
  const activeToday = new Set(
    appointments
      .filter(
        (appointment) =>
          appointment.employee_id &&
          getDateKey(appointment.start_time) === todayKey &&
          !OCCUPANCY_EXCLUDED_STATUSES.has(appointment.status)
      )
      .map((appointment) => appointment.employee_id as string)
  ).size;
  const employeeStats = employees.map(
    (employee) => statsByEmployeeId[employee.id] ?? createEmptyEmployeeStats()
  );
  const totalRevenue = employeeStats.reduce(
    (sum, stats) => sum + stats.revenue,
    0
  );
  const averageOccupancy =
    employeeStats.length > 0
      ? Math.round(
          employeeStats.reduce((sum, stats) => sum + stats.occupancy, 0) /
            employeeStats.length
        )
      : 0;

  return {
    totalEmployees: employees.length,
    activeToday,
    totalRevenue,
    averageOccupancy,
  };
}

export async function getEmployeeStats(
  salonId: string,
  employees: Employee[],
  workingHours: WorkingHour[]
): Promise<{
  statsByEmployeeId: Record<string, EmployeeStats>;
  appointments: EmployeeAppointmentAnalyticsRow[];
}> {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, employee_id, client_id, status, price, start_time, end_time, duration_minutes"
    )
    .eq("salon_id", salonId)
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const appointments = (data ?? []) as EmployeeAppointmentAnalyticsRow[];
  const statsByEmployeeId: Record<string, EmployeeStats> = Object.fromEntries(
    employees.map((employee) => [employee.id, createEmptyEmployeeStats()])
  );
  const completedAppointmentsByClient = new Map<
    string,
    EmployeeAppointmentAnalyticsRow[]
  >();

  appointments.forEach((appointment) => {
    if (!appointment.employee_id) {
      return;
    }

    const stats =
      statsByEmployeeId[appointment.employee_id] ?? createEmptyEmployeeStats();

    stats.totalAppointments += 1;

    if (
      !stats.lastAppointmentAt ||
      new Date(appointment.start_time) > new Date(stats.lastAppointmentAt)
    ) {
      stats.lastAppointmentAt = appointment.start_time;
    }

    if (appointment.status === REVENUE_STATUS) {
      stats.completedAppointments += 1;
      stats.revenue += appointment.price ?? 0;

      if (appointment.client_id) {
        const clientAppointments =
          completedAppointmentsByClient.get(appointment.client_id) ?? [];
        clientAppointments.push(appointment);
        completedAppointmentsByClient.set(appointment.client_id, clientAppointments);
      }
    }

    statsByEmployeeId[appointment.employee_id] = stats;
  });

  const newClientIdsByEmployee = new Map<string, Set<string>>();
  const returningClientIdsByEmployee = new Map<string, Set<string>>();

  completedAppointmentsByClient.forEach((clientAppointments, clientId) => {
    clientAppointments.sort(
      (first, second) =>
        new Date(first.start_time).getTime() - new Date(second.start_time).getTime()
    );

    const firstAppointment = clientAppointments[0];

    if (firstAppointment?.employee_id) {
      const current =
        newClientIdsByEmployee.get(firstAppointment.employee_id) ?? new Set<string>();
      current.add(clientId);
      newClientIdsByEmployee.set(firstAppointment.employee_id, current);
    }

    if (clientAppointments.length > 1) {
      const employeeIds = new Set(
        clientAppointments
          .map((appointment) => appointment.employee_id)
          .filter(Boolean) as string[]
      );

      employeeIds.forEach((employeeId) => {
        const current =
          returningClientIdsByEmployee.get(employeeId) ?? new Set<string>();
        current.add(clientId);
        returningClientIdsByEmployee.set(employeeId, current);
      });
    }
  });

  employees.forEach((employee) => {
    const stats = statsByEmployeeId[employee.id] ?? createEmptyEmployeeStats();

    stats.newClients = newClientIdsByEmployee.get(employee.id)?.size ?? 0;
    stats.returningClients =
      returningClientIdsByEmployee.get(employee.id)?.size ?? 0;
    stats.averageAppointmentValue =
      stats.completedAppointments > 0
        ? Number((stats.revenue / stats.completedAppointments).toFixed(2))
        : 0;
    stats.occupancy = calculateEmployeeOccupancy(
      employee.id,
      appointments,
      workingHours
    );

    statsByEmployeeId[employee.id] = stats;
  });

  return { statsByEmployeeId, appointments };
}

export async function getEmployeeAnalytics(
  salonId: string,
  employees: Employee[],
  workingHours: WorkingHour[]
): Promise<EmployeeAnalytics> {
  const { statsByEmployeeId, appointments } = await getEmployeeStats(
    salonId,
    employees,
    workingHours
  );

  return {
    statsByEmployeeId,
    kpis: getEmployeeKPIs(employees, statsByEmployeeId, appointments),
  };
}

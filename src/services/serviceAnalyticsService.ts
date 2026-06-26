import { supabase } from "@/lib/supabase/client";
import type { Service } from "@/types/service";

export type ServiceStats = {
  totalAppointments: number;
  completedAppointments: number;
  revenue: number;
  averageAppointmentValue: number;
  lastBookedAt: string | null;
  popularity: number;
  popularityPercent: number;
};

export type ServiceKPIs = {
  totalServices: number;
  activeServices: number;
  averagePrice: number;
  averageDuration: number;
};

export type ServiceAnalytics = {
  kpis: ServiceKPIs;
  statsByServiceId: Record<string, ServiceStats>;
};

type AppointmentAnalyticsRow = {
  id: string;
  primary_service_id: string | null;
  status: string;
  price: number | null;
  start_time: string;
};

export function createEmptyServiceStats(): ServiceStats {
  return {
    totalAppointments: 0,
    completedAppointments: 0,
    revenue: 0,
    averageAppointmentValue: 0,
    lastBookedAt: null,
    popularity: 0,
    popularityPercent: 0,
  };
}

export function getServiceKPIs(services: Service[]): ServiceKPIs {
  const totalServices = services.length;
  const activeServices = services.filter((service) => service.is_active).length;
  const totalPrice = services.reduce(
    (sum, service) => sum + Number(service.price || 0),
    0
  );
  const totalDuration = services.reduce(
    (sum, service) => sum + service.duration_minutes,
    0
  );

  return {
    totalServices,
    activeServices,
    averagePrice:
      totalServices > 0 ? Number((totalPrice / totalServices).toFixed(2)) : 0,
    averageDuration:
      totalServices > 0 ? Math.round(totalDuration / totalServices) : 0,
  };
}

export async function getServiceStats(
  salonId: string
): Promise<Record<string, ServiceStats>> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, primary_service_id, status, price, start_time")
    .eq("salon_id", salonId)
    .order("start_time", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as AppointmentAnalyticsRow[];
  const statsByServiceId: Record<string, ServiceStats> = {};
  const totalCompletedAppointments = rows.filter(
    (appointment) => appointment.status === "completed"
  ).length;

  rows.forEach((appointment) => {
    if (!appointment.primary_service_id) {
      return;
    }

    const stats =
      statsByServiceId[appointment.primary_service_id] ?? createEmptyServiceStats();

    stats.totalAppointments += 1;
    stats.lastBookedAt ??= appointment.start_time;

    if (appointment.status === "completed") {
      stats.completedAppointments += 1;
      stats.revenue += appointment.price ?? 0;
    }

    statsByServiceId[appointment.primary_service_id] = stats;
  });

  Object.values(statsByServiceId).forEach((stats) => {
    stats.averageAppointmentValue =
      stats.completedAppointments > 0
        ? Number((stats.revenue / stats.completedAppointments).toFixed(2))
        : 0;
    stats.popularity = stats.completedAppointments;
    stats.popularityPercent =
      totalCompletedAppointments > 0
        ? Math.round((stats.completedAppointments / totalCompletedAppointments) * 100)
        : 0;
  });

  return statsByServiceId;
}

export async function getServiceAnalytics(
  salonId: string,
  services: Service[]
): Promise<ServiceAnalytics> {
  const statsByServiceId = await getServiceStats(salonId);

  return {
    kpis: getServiceKPIs(services),
    statsByServiceId,
  };
}

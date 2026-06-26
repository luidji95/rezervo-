import { supabase } from "@/lib/supabase/client";

export type ClientFavoriteService = {
  serviceId: string;
  name: string;
  count: number;
};

export type ClientHistoryItem = {
  id: string;
  startTime: string;
  serviceName: string;
  price: number;
};

export type ClientMetrics = {
  visits: number;
  totalSpent: number;
  averageSpent: number;
  lastVisitAt: string | null;
  favoriteServices: ClientFavoriteService[];
  history: ClientHistoryItem[];
};

export type ClientKpis = {
  visitsThisMonth: number;
  returningClients: number;
  returningClientsPercent: number;
  clientsWithVisits: number;
  revenueThisMonth: number;
};

export type ClientAnalytics = {
  metricsByClientId: Record<string, ClientMetrics>;
  kpis: ClientKpis;
};

type AppointmentAnalyticsRow = {
  id: string;
  client_id: string | null;
  start_time: string;
  status: string;
  price: number | null;
  services:
    | {
        id: string;
        name: string;
      }
    | {
        id: string;
        name: string;
      }[]
    | null;
};

const emptyKpis: ClientKpis = {
  visitsThisMonth: 0,
  returningClients: 0,
  returningClientsPercent: 0,
  clientsWithVisits: 0,
  revenueThisMonth: 0,
};

function getMonthBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

  return { start, end };
}

function normalizeRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function createEmptyMetrics(): ClientMetrics {
  return {
    visits: 0,
    totalSpent: 0,
    averageSpent: 0,
    lastVisitAt: null,
    favoriteServices: [],
    history: [],
  };
}

export async function getClientAnalytics(salonId: string): Promise<ClientAnalytics> {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      client_id,
      start_time,
      status,
      price,
      services:primary_service_id (
        id,
        name
      )
    `
    )
    .eq("salon_id", salonId)
    .eq("status", "completed")
    .order("start_time", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as AppointmentAnalyticsRow[];
  const metricsByClientId: Record<string, ClientMetrics> = {};
  const serviceCountersByClientId = new Map<string, Map<string, ClientFavoriteService>>();
  const now = new Date();
  const { start: monthStart, end: monthEnd } = getMonthBounds(now);
  let visitsThisMonth = 0;
  let revenueThisMonth = 0;

  rows.forEach((appointment) => {
    if (!appointment.client_id) {
      return;
    }

    const clientMetrics =
      metricsByClientId[appointment.client_id] ?? createEmptyMetrics();
    const price = appointment.price ?? 0;
    const appointmentDate = new Date(appointment.start_time);
    const service = normalizeRelation(appointment.services);
    const serviceId = service?.id ?? "unknown";
    const serviceName = service?.name ?? "Bez usluge";

    clientMetrics.visits += 1;
    clientMetrics.totalSpent += price;
    clientMetrics.lastVisitAt ??= appointment.start_time;

    if (clientMetrics.history.length < 5) {
      clientMetrics.history.push({
        id: appointment.id,
        startTime: appointment.start_time,
        serviceName,
        price,
      });
    }

    const serviceCounters =
      serviceCountersByClientId.get(appointment.client_id) ??
      new Map<string, ClientFavoriteService>();
    const currentService = serviceCounters.get(serviceId);

    if (currentService) {
      currentService.count += 1;
    } else {
      serviceCounters.set(serviceId, {
        serviceId,
        name: serviceName,
        count: 1,
      });
    }

    serviceCountersByClientId.set(appointment.client_id, serviceCounters);
    metricsByClientId[appointment.client_id] = clientMetrics;

    if (appointmentDate >= monthStart && appointmentDate <= monthEnd) {
      visitsThisMonth += 1;
      revenueThisMonth += price;
    }
  });

  Object.entries(metricsByClientId).forEach(([clientId, metrics]) => {
    metrics.averageSpent =
      metrics.visits > 0 ? Number((metrics.totalSpent / metrics.visits).toFixed(2)) : 0;
    metrics.favoriteServices = [
      ...(serviceCountersByClientId.get(clientId)?.values() ?? []),
    ]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 3);
  });

  const clientMetrics = Object.values(metricsByClientId);
  const clientsWithVisits = clientMetrics.filter((metrics) => metrics.visits > 0).length;
  const returningClients = clientMetrics.filter((metrics) => metrics.visits >= 2).length;
  const returningClientsPercent =
    clientsWithVisits > 0 ? Math.round((returningClients / clientsWithVisits) * 100) : 0;

  return {
    metricsByClientId,
    kpis: {
      ...emptyKpis,
      visitsThisMonth,
      returningClients,
      returningClientsPercent,
      clientsWithVisits,
      revenueThisMonth,
    },
  };
}

import { supabase } from "@/lib/supabase/client";
import type { AppointmentListItem } from "@/services/appointmentQueryService";

export type PopularService = {
  serviceId: string;
  name: string;
  appointments: number;
};

export type TopClient = {
  clientId: string;
  fullName: string;
  totalPrice: number;
  appointmentCount: number;
};

function getMonthBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export async function getPopularServices(
  salonId: string,
  limit = 5
): Promise<PopularService[]> {
  const { start, end } = getMonthBounds(new Date());
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      services:primary_service_id ( id, name ),
      status,
      start_time
    `
    )
    .eq("salon_id", salonId)
    .eq("status", "completed")
    .gte("start_time", start.toISOString())
    .lte("start_time", end.toISOString());

  if (error) {
    throw new Error(error.message);
  }

  const reducer = new Map<string, PopularService>();

  (data ?? []).forEach((appointment) => {
    const services = appointment.services;
    const service = Array.isArray(services) ? services[0] : services;

    if (!service?.id) {
      return;
    }

    const key = service.id;
    const current = reducer.get(key);

    if (current) {
      current.appointments += 1;
    } else {
      reducer.set(key, {
        serviceId: service.id,
        name: service.name || "Nepoznata usluga",
        appointments: 1,
      });
    }
  });

  return [...reducer.values()]
    .sort((a, b) => b.appointments - a.appointments)
    .slice(0, limit);
}

export async function getTopClients(
  salonId: string,
  limit = 5
): Promise<TopClient[]> {
  const { start, end } = getMonthBounds(new Date());
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      price,
      status,
      start_time,
      clients ( id, full_name )
    `
    )
    .eq("salon_id", salonId)
    .eq("status", "completed")
    .gte("start_time", start.toISOString())
    .lte("start_time", end.toISOString());

  if (error) {
    throw new Error(error.message);
  }

  const reducer = new Map<string, TopClient>();

  (data ?? []).forEach((appointment) => {
    const clients = appointment.clients;
    const client = Array.isArray(clients) ? clients[0] : clients;

    if (!client?.id) {
      return;
    }

    const key = client.id;
    const current = reducer.get(key);

    if (current) {
      current.totalPrice += appointment.price ?? 0;
      current.appointmentCount += 1;
    } else {
      reducer.set(key, {
        clientId: client.id,
        fullName: client.full_name || "Nepozvan klijent",
        totalPrice: appointment.price ?? 0,
        appointmentCount: 1,
      });
    }
  });

  return [...reducer.values()]
    .sort((a, b) => b.totalPrice - a.totalPrice)
    .slice(0, limit);
}

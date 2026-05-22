import { supabase } from "@/lib/supabase/client";
export type AppointmentListItem = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  payment_status: string;
  booking_source: string;
  price: number;
  currency: string;
  customer_note: string | null;
  internal_note: string | null;

  clients: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;

  employees: {
    id: string;
    full_name: string;
    display_name: string | null;
  } | null;

  services: {
    id: string;
    name: string;
    duration_minutes: number;
  } | null;
};

export async function getSalonAppointmentsByDate(
  salonId: string,
  date: string
): Promise<AppointmentListItem[]> {
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
      payment_status,
      booking_source,
      price,
      currency,
      customer_note,
      internal_note,
      clients (
        id,
        full_name,
        phone,
        email
      ),
      employees (
        id,
        full_name,
        display_name
      ),
      services:primary_service_id (
        id,
        name,
        duration_minutes
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
  return (data ?? []) as unknown as AppointmentListItem[];
  
}
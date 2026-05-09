import { supabase } from "@/lib/supabase/client";
import type { CreateServiceInput, Service, UpdateServiceInput } from "@/types/service";


export async function createService({
  salonId,
  name,
  description,
  durationMinutes,
  priceAmount,
}: CreateServiceInput): Promise<Service> {
  const { data, error } = await supabase
    .from("services")
    .insert({
      salon_id: salonId,
      name,
      description,
      duration_minutes: durationMinutes,
      price: priceAmount,
    })
    .select(
      `
      id,
      salon_id,
      category_id,
      name,
      description,
      duration_minutes,
      buffer_minutes,
      price,
      currency,
      is_active,
      is_public,
      color,
      sort_order,
      created_at,
      updated_at
    `
    )
    .single();

  if (error) {
    throw error;
  }

  return data as Service;
}

export async function getSalonServices(salonId: string): Promise<Service[]> {
  const { data, error } = await supabase
    .from("services")
    .select(
      `
      id,
      salon_id,
      category_id,
      name,
      description,
      duration_minutes,
      buffer_minutes,
      price,
      currency,
      is_active,
      is_public,
      color,
      sort_order,
      created_at,
      updated_at
    `
    )
    .eq("salon_id", salonId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Service[];
}

export async function deleteService(serviceId: string) {
  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", serviceId);

  if (error) {
    throw error;
  }
}

export async function updateService({
  serviceId,
  name,
  description,
  durationMinutes,
  priceAmount,
}: UpdateServiceInput): Promise<Service> {
  const { data, error } = await supabase
    .from("services")
    .update({
      name,
      description,
      duration_minutes: durationMinutes,
      price: priceAmount,
    })
    .eq("id", serviceId)
    .select(
      `
      id,
      salon_id,
      category_id,
      name,
      description,
      duration_minutes,
      buffer_minutes,
      price,
      currency,
      is_active,
      is_public,
      color,
      sort_order,
      created_at,
      updated_at
    `
    )
    .single();

  if (error) {
    throw error;
  }

  return data as Service;
}
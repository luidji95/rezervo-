import { supabase } from "@/lib/supabase/client";
import type {
  CreateServiceInput,
  Service,
  UpdateServiceInput,
} from "@/types/service";

const SERVICE_SELECT = `
  id,
  salon_id,
  category_id,
  category_name,
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
`;

export async function createService({
  salonId,
  name,
  description,
  categoryName,
  durationMinutes,
  priceAmount,
  isActive = true,
  isPublic = true,
}: CreateServiceInput): Promise<Service> {
  const { data, error } = await supabase
    .from("services")
    .insert({
      salon_id: salonId,
      name,
      description: description || null,
      category_name: categoryName || null,
      duration_minutes: durationMinutes,
      price: priceAmount,
      is_active: isActive,
      is_public: isPublic,
    })
    .select(SERVICE_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data as Service;
}

export async function getSalonServices(salonId: string): Promise<Service[]> {
  const { data, error } = await supabase
    .from("services")
    .select(SERVICE_SELECT)
    .eq("salon_id", salonId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Service[];
}

export async function updateService({
  serviceId,
  name,
  description,
  categoryName,
  durationMinutes,
  priceAmount,
  isActive,
  isPublic,
}: UpdateServiceInput): Promise<Service> {
  const { data, error } = await supabase
    .from("services")
    .update({
      name,
      description: description || null,
      category_name: categoryName || null,
      duration_minutes: durationMinutes,
      price: priceAmount,
      ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
      ...(typeof isPublic === "boolean" ? { is_public: isPublic } : {}),
    })
    .eq("id", serviceId)
    .select(SERVICE_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data as Service;
}

export async function deleteService(serviceId: string): Promise<void> {
  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", serviceId);

  if (error) {
    throw error;
  }
}

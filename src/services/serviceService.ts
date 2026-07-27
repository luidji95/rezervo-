import { supabase } from "@/lib/supabase/client";
import type {
  CreateServiceInput,
  Service,
  UpdateServiceInput,
} from "@/types/service";
import { throwBusinessDataMutationError } from "@/features/business-data/services/businessDataMutationError";

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

function logServiceOperationError({
  operation,
  serviceId,
  payload,
  error,
}: {
  operation: "create" | "update" | "delete";
  serviceId?: string;
  payload: unknown;
  error: {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  } | null;
}) {
  console.error("Service operation failed", {
    operation,
    serviceId,
    payload,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    full: JSON.stringify(error, null, 2),
  });
}

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
  const payload = {
    salon_id: salonId,
    name,
    description: description || null,
    category_name: categoryName || null,
    duration_minutes: durationMinutes,
    price: priceAmount,
    is_active: isActive,
    is_public: isPublic,
  };

  const { data, error } = await supabase.rpc("create_service_v1", {
    p_salon_id: salonId, p_name: name, p_description: description,
    p_category_name: categoryName, p_duration_minutes: durationMinutes,
    p_price: priceAmount, p_is_active: isActive, p_is_public: isPublic,
  });

  if (error) {
    logServiceOperationError({
      operation: "create",
      payload,
      error,
    });
    throwBusinessDataMutationError(error);
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
  const payload = {
    name,
    description: description || null,
    category_name: categoryName || null,
    duration_minutes: durationMinutes,
    price: priceAmount,
    ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
    ...(typeof isPublic === "boolean" ? { is_public: isPublic } : {}),
  };

  const { data, error } = await supabase.rpc("update_service_v1", {
    p_service_id: serviceId, p_name: name, p_description: description,
    p_category_name: categoryName, p_duration_minutes: durationMinutes,
    p_price: priceAmount, p_is_active: isActive, p_is_public: isPublic,
  });

  if (error) {
    logServiceOperationError({
      operation: "update",
      serviceId,
      payload,
      error,
    });
    throwBusinessDataMutationError(error);
  }

  return data as Service;
}

export async function deleteService(serviceId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_service_safely_v1", { p_service_id: serviceId });

  if (error) {
    logServiceOperationError({
      operation: "delete",
      serviceId,
      payload: { id: serviceId },
      error,
    });
    throwBusinessDataMutationError(error);
  }
}

export type DeleteServiceSafelyResult = {
  mode: "hard" | "soft";
};

export async function serviceHasAppointmentHistory(
  serviceId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("appointment_services")
    .select("id")
    .eq("service_id", serviceId)
    .limit(1);

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

export async function deleteServiceSafely({
  serviceId,
  salonId,
}: {
  serviceId: string;
  salonId: string;
}): Promise<DeleteServiceSafelyResult> {
  void salonId;
  const { data, error } = await supabase.rpc("delete_service_safely_v1", { p_service_id: serviceId });
  if (error) throwBusinessDataMutationError(error);
  return { mode: (data?.[0]?.mode ?? "soft") as "hard" | "soft" };
}

export async function restoreService({
  serviceId,
  salonId,
}: {
  serviceId: string;
  salonId: string;
}): Promise<void> {
  void salonId;
  const { error } = await supabase.rpc("set_service_active_state_v1", {
    p_service_id: serviceId, p_is_active: true,
  });

  if (error) {
    logServiceOperationError({
      operation: "update",
      serviceId,
      payload: { is_active: true },
      error,
    });
    throwBusinessDataMutationError(error);
  }
}

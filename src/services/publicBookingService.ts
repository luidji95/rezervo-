import { supabase } from "@/lib/supabase/client";

export async function getPublicSalonBySlug(slug: string) {
  const { data, error } = await supabase
    .from("salons")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    throw new Error("Salon not found.");
  }

  return data;
}

export async function getPublicServices(salonId: string) {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch public services.");
  }

  return data;
}

export async function getPublicEmployees(salonId: string) {
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .eq("is_bookable", true)
    .eq("is_public", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch public employees.");
  }

  return data;
}

export async function getPublicEmployeesForService(
  salonId: string,
  serviceId: string
) {
  const { data, error } = await supabase
    .from("employee_services")
    .select(`
      employee_id,
      employees (
        id,
        full_name,
        display_name,
        avatar_url,
        position,
        is_active,
        is_bookable,
        is_public
      )
    `)
    .eq("salon_id", salonId)
    .eq("service_id", serviceId)
    .eq("is_active", true);

  if (error) {
    throw new Error("Failed to fetch employees for service.");
  }

  return data
    .map((item) => item.employees)
    .filter(Boolean);
}
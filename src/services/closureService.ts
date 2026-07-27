import { supabase } from "@/lib/supabase/client";
import type { Closure, CreateClosurePayload } from "@/types/closure";

export async function getSalonClosures(salonId: string): Promise<Closure[]> {
  const { data, error } = await supabase
    .from("closures")
    .select("*")
    .eq("salon_id", salonId)
    .order("starts_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createClosure(
  payload: CreateClosurePayload
): Promise<Closure> {
  const { data, error } = await supabase.rpc("create_closure_v1", {
    p_salon_id: payload.salon_id,
    p_employee_id: payload.employee_id ?? null,
    p_title: payload.title,
    p_reason: payload.reason ?? null,
    p_starts_at: payload.starts_at,
    p_ends_at: payload.ends_at,
    p_is_full_day: payload.is_full_day,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Closure;
}

export async function deleteClosure(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_closure_v1", {
    p_closure_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }
}

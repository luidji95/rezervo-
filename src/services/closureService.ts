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
  const { data, error } = await supabase
    .from("closures")
    .insert({
      salon_id: payload.salon_id,
      employee_id: payload.employee_id ?? null,
      title: payload.title,
      reason: payload.reason ?? null,
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
      is_full_day: payload.is_full_day,
      created_by: payload.created_by ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deleteClosure(id: string): Promise<void> {
  const { error } = await supabase.from("closures").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}
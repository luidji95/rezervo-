import "server-only";

import { unstable_cache } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizePublicPlanCatalog } from "./publicPlanCatalogCore";
import type { PublicPlan } from "../types";

const load = unstable_cache(async (): Promise<PublicPlan[]> => {
  const { data, error } = await supabaseServer.from("plans").select(
    "slug,name,monthly_price,yearly_price,currency,max_employees,is_active,analytics_enabled,sms_reminders_enabled,ai_receptionist_enabled,whatsapp_enabled,instagram_enabled,marketing_enabled,sort_order",
  ).in("slug", ["starter", "pro", "premium"]).order("sort_order");
  if (error) throw new Error("PUBLIC_PLAN_CATALOG_QUERY_FAILED");
  return normalizePublicPlanCatalog(data ?? []);
}, ["public-plan-catalog-v1"], { revalidate: 3600, tags: ["public-plan-catalog"] });

export async function getPublicPlanCatalog(): Promise<PublicPlan[] | null> {
  try {
    return await load();
  } catch (error) {
    console.error("Public plan catalog unavailable", {
      code: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN_ERROR",
    });
    return null;
  }
}

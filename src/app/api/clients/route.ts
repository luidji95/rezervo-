import { NextResponse } from "next/server";

import { clientsQuerySchema } from "@/features/clients/schemas";
import type { ClientsPageResponse } from "@/features/clients/types";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { getDayRangeUtc, getTodayDateKey } from "@/lib/salonDateTime";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function response(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status, headers: { "Cache-Control": "no-store" } });
}

function nextMonthStart(dateKey: string) {
  const [year, month] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function GET(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return response("UNAUTHORIZED", "Morate biti prijavljeni.", 401);
  const url = new URL(request.url);
  const parsed = clientsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return response("INVALID_QUERY", "Filter klijenata nije ispravan.", 400);

  const { data: salon, error: salonError } = await supabaseServer
    .from("salons")
    .select("id,owner_id,timezone")
    .eq("id", parsed.data.salonId)
    .maybeSingle();
  if (salonError || !salon) return response("CLIENTS_LOAD_FAILED", "Klijente trenutno nije moguće učitati.", 500);

  let isOwner = salon.owner_id === auth.user.id;
  if (!isOwner) {
    const { data: membership, error } = await supabaseServer
      .from("salon_members")
      .select("id")
      .eq("salon_id", salon.id)
      .eq("profile_id", auth.user.id)
      .eq("role", "owner")
      .eq("status", "active")
      .maybeSingle();
    if (error) return response("CLIENTS_LOAD_FAILED", "Klijente trenutno nije moguće učitati.", 500);
    isOwner = Boolean(membership);
  }
  if (!isOwner) return response("FORBIDDEN", "Nemate dozvolu za pregled klijenata.", 403);

  const timezone = salon.timezone || "Europe/Belgrade";
  const monthStartKey = `${getTodayDateKey(timezone).slice(0, 7)}-01`;
  const monthEndKey = nextMonthStart(monthStartKey);
  const { data, error } = await supabaseServer.rpc("get_owner_clients_page_v1", {
    p_salon_id: salon.id,
    p_page: parsed.data.page,
    p_page_size: parsed.data.pageSize,
    p_search: parsed.data.search,
    p_status: parsed.data.status,
    p_sort: parsed.data.sort,
    p_month_start_utc: getDayRangeUtc(monthStartKey, timezone).startUtc.toISOString(),
    p_month_end_utc: getDayRangeUtc(monthEndKey, timezone).startUtc.toISOString(),
  });
  if (error || !data) {
    if (process.env.NODE_ENV === "development") console.error("CLIENTS_PAGE_RPC_FAILED", { code: error?.code ?? null, message: error?.message ?? "No data" });
    return response("CLIENTS_LOAD_FAILED", "Klijente trenutno nije moguće učitati.", 500);
  }

  const raw = data as Omit<ClientsPageResponse, "totalPages">;
  const clients: ClientsPageResponse = {
    ...raw,
    totalPages: Math.max(1, Math.ceil(Number(raw.totalCount) / Number(raw.pageSize))),
    kpis: {
      ...raw.kpis,
      returningClientsPercent: raw.kpis.clientsWithVisits > 0
        ? Math.round(raw.kpis.returningClients / raw.kpis.clientsWithVisits * 100)
        : 0,
    },
  };
  return NextResponse.json({ success: true, clients }, { headers: { "Cache-Control": "no-store" } });
}

import { supabase } from "@/lib/supabase/client";
import type { ClientsPageResponse, ClientsSort, ClientsStatus } from "./types";

export class ClientsPageError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_QUERY" | "CLIENTS_LOAD_FAILED") {
    super(code);
  }
}

export async function getClientsPage(input: {
  salonId: string;
  page: number;
  pageSize: number;
  search: string;
  status: ClientsStatus;
  sort: ClientsSort;
  signal?: AbortSignal;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ClientsPageError("UNAUTHORIZED");
  const query = new URLSearchParams({
    salonId: input.salonId,
    page: String(input.page),
    pageSize: String(input.pageSize),
    search: input.search,
    status: input.status,
    sort: input.sort,
  });
  const response = await fetch(`/api/clients?${query}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
    signal: input.signal,
  });
  const body = await response.json().catch(() => null) as
    | { success: true; clients: ClientsPageResponse }
    | { success: false; code?: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_QUERY" | "CLIENTS_LOAD_FAILED" }
    | null;
  if (!response.ok || !body?.success) {
    throw new ClientsPageError(body && "code" in body && body.code ? body.code : "CLIENTS_LOAD_FAILED");
  }
  return body.clients;
}

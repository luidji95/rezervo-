"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useSalon } from "@/context/SalonContext";
import { clientsQuerySchema } from "@/features/clients/schemas";
import { ClientsPageError, getClientsPage } from "@/features/clients/clientPageService";
import type { ClientPageItem, ClientsPageResponse, ClientsSort, ClientsStatus } from "@/features/clients/types";
import { deleteClient } from "@/services/clientService";

const EMPTY_PAGE: ClientsPageResponse = {
  items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 1,
  kpis: { totalClients: 0, newClientsThisMonth: 0, visitsThisMonth: 0, revenueThisMonth: 0, clientsWithVisits: 0, returningClients: 0, returningClientsPercent: 0 },
};

export function useClientsPageData() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentSalon, salonLoading } = useSalon();
  const salonId = currentSalon?.id;
  const parsed = useMemo(() => {
    const fallback = { salonId: salonId ?? "00000000-0000-0000-0000-000000000000", page: 1, pageSize: 20, search: "", status: "all" as const, sort: "newest" as const };
    const result = clientsQuerySchema.safeParse({
      salonId: fallback.salonId,
      page: searchParams.get("page") ?? 1,
      pageSize: 20,
      search: searchParams.get("search") ?? "",
      status: searchParams.get("status") ?? "all",
      sort: searchParams.get("sort") ?? "newest",
    });
    return result.success ? result.data : fallback;
  }, [salonId, searchParams]);
  const [result, setResult] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchValue, setSearchValue] = useState(parsed.search);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  const updateQuery = useCallback((patch: Partial<{ page: number; search: string; status: ClientsStatus; sort: ClientsSort }>) => {
    const query = new URLSearchParams(searchParams.toString());
    const nextPage = patch.page ?? (patch.search !== undefined || patch.status !== undefined || patch.sort !== undefined ? 1 : parsed.page);
    query.set("page", String(nextPage));
    query.set("search", patch.search ?? parsed.search);
    query.set("status", patch.status ?? parsed.status);
    query.set("sort", patch.sort ?? parsed.sort);
    router.replace(`/clients?${query.toString()}`, { scroll: false });
  }, [parsed, router, searchParams]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchValue(parsed.search), 0);
    return () => window.clearTimeout(timeout);
  }, [parsed.search]);
  useEffect(() => {
    if (searchValue === parsed.search) return;
    const timeout = window.setTimeout(() => updateQuery({ search: searchValue.trim() }), 300);
    return () => window.clearTimeout(timeout);
  }, [parsed.search, searchValue, updateQuery]);

  useEffect(() => {
    if (!salonId) return;
    const controller = new AbortController();
    const request = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void getClientsPage({ salonId, page: parsed.page, pageSize: 20, search: parsed.search, status: parsed.status, sort: parsed.sort, signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          setResult(data);
          setSelectedId((current) => data.items.some((client) => client.id === current) ? current : data.items[0]?.id ?? null);
        })
        .catch((requestError) => {
          if (controller.signal.aborted) return;
          setResult((current) => ({ ...current, items: [] }));
          setError(requestError instanceof ClientsPageError && requestError.code === "FORBIDDEN" ? "Nemate dozvolu za pregled klijenata." : "Klijente trenutno nije moguće učitati.");
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(request); controller.abort(); };
  }, [parsed.page, parsed.search, parsed.sort, parsed.status, requestVersion, salonId]);

  const selectedClient = result.items.find((client) => client.id === selectedId) ?? null;
  const retry = useCallback(() => setRequestVersion((value) => value + 1), []);
  const handleDeleteClient = useCallback(async (clientId: string) => {
    if (!window.confirm("Da li sigurno želite da obrišete ovog klijenta?")) return;
    await deleteClient(clientId);
    retry();
  }, [retry]);

  return {
    currentSalon, salonId, salonLoading, loading, error, result, selectedClient,
    searchValue, setSearchValue, status: parsed.status, sort: parsed.sort, retry, handleDeleteClient,
    selectClient: (client: ClientPageItem) => setSelectedId(client.id),
    setPage: (page: number) => updateQuery({ page }),
    setStatus: (status: ClientsStatus) => updateQuery({ status }),
    setSort: (sort: ClientsSort) => updateQuery({ sort }),
    reload: retry,
  };
}

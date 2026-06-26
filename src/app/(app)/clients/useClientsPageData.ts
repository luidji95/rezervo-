"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSalon } from "@/context/SalonContext";
import {
  getClientAnalytics,
  type ClientAnalytics,
  type ClientKpis,
  type ClientMetrics,
} from "@/services/clientAnalyticsService";
import { deleteClient, getSalonClients } from "@/services/clientService";
import type { Client } from "@/types/client";
import { getClientSourceLabel } from "./clientUtils";

const emptyClientKpis: ClientKpis = {
  visitsThisMonth: 0,
  returningClients: 0,
  returningClientsPercent: 0,
  clientsWithVisits: 0,
  revenueThisMonth: 0,
};

function getEmptyClientMetrics(): ClientMetrics {
  return {
    visits: 0,
    totalSpent: 0,
    averageSpent: 0,
    lastVisitAt: null,
    favoriteServices: [],
    history: [],
  };
}

export function useClientsPageData() {
  const { currentSalon, salonLoading } = useSalon();

  const [clients, setClients] = useState<Client[]>([]);
  const [analytics, setAnalytics] = useState<ClientAnalytics>({
    metricsByClientId: {},
    kpis: emptyClientKpis,
  });
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  const salonId = currentSalon?.id;

  const loadData = useCallback(async () => {
    if (!salonId) return;

    try {
      setLoading(true);

      const [clientsData, analyticsData] = await Promise.all([
        getSalonClients(salonId),
        getClientAnalytics(salonId),
      ]);

      setClients(clientsData);
      setAnalytics(analyticsData);
      setSelectedClient((current) => {
        if (current) {
          return (
            clientsData.find((client) => client.id === current.id) ??
            clientsData[0] ??
            null
          );
        }

        return clientsData[0] ?? null;
      });
    } catch (error) {
      console.error("Greska pri ucitavanju klijenata:", error);
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadData]);

  const sourceOptions = useMemo(() => {
    const sources = new Set<string>();

    clients.forEach((client) => {
      sources.add(getClientSourceLabel(client.source));
    });

    return Array.from(sources);
  }, [clients]);

  const filteredClients = useMemo(() => {
    const search = searchValue.trim().toLowerCase();

    return clients.filter((client) => {
      const matchesSearch =
        client.full_name.toLowerCase().includes(search) ||
        client.phone?.toLowerCase().includes(search) ||
        client.email?.toLowerCase().includes(search);

      const matchesSource =
        sourceFilter === "all" ||
        getClientSourceLabel(client.source) === sourceFilter;

      return matchesSearch && matchesSource;
    });
  }, [clients, searchValue, sourceFilter]);

  const selectedClientMetrics = useMemo(() => {
    if (!selectedClient) {
      return getEmptyClientMetrics();
    }

    return analytics.metricsByClientId[selectedClient.id] ?? getEmptyClientMetrics();
  }, [analytics.metricsByClientId, selectedClient]);

  const newClientsThisMonth = useMemo(() => {
    const now = new Date();

    return clients.filter((client) => {
      const createdAt = new Date(client.created_at);

      return (
        createdAt.getMonth() === now.getMonth() &&
        createdAt.getFullYear() === now.getFullYear()
      );
    }).length;
  }, [clients]);

  async function handleDeleteClient(clientId: string) {
    const confirmed = window.confirm(
      "Da li sigurno zelis da obrises ovog klijenta?"
    );

    if (!confirmed) return;

    try {
      await deleteClient(clientId);
      await loadData();
    } catch (error) {
      console.error("Greska pri brisanju klijenta:", error);
    }
  }

  return {
    clients,
    clientKpis: analytics.kpis,
    clientMetricsByClientId: analytics.metricsByClientId,
    currentSalon,
    filteredClients,
    handleDeleteClient,
    loadData,
    loading,
    newClientsThisMonth,
    salonId,
    salonLoading,
    searchValue,
    selectedClient,
    selectedClientMetrics,
    setSearchValue,
    setSelectedClient,
    setSourceFilter,
    sourceFilter,
    sourceOptions,
  };
}

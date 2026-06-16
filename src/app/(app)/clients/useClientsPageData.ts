"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSalon } from "@/context/SalonContext";
import { deleteClient, getSalonClients } from "@/services/clientService";
import type { Client } from "@/types/client";
import {
  getClientSourceLabel,
  getClientStatus,
  getDummyTag,
} from "./clientUtils";

export type ClientStatusFilter = "all" | "active" | "inactive";

export function useClientsPageData() {
  const { currentSalon, salonLoading } = useSalon();

  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ClientStatusFilter>("all");

  const salonId = currentSalon?.id;

  const loadData = useCallback(async () => {
    if (!salonId) return;

    try {
      setLoading(true);

      const clientsData = await getSalonClients(salonId);

      setClients(clientsData);
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
    const sources = new Set(["Instagram", "Web", "WhatsApp", "Preporuka"]);

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

      const matchesStatus =
        statusFilter === "all" || getClientStatus(client) === statusFilter;

      const matchesTag =
        tagFilter === "all" || getDummyTag(client.id) === tagFilter;

      return matchesSearch && matchesSource && matchesStatus && matchesTag;
    });
  }, [clients, searchValue, sourceFilter, statusFilter, tagFilter]);

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
    setSearchValue,
    setSelectedClient,
    setSourceFilter,
    setStatusFilter,
    setTagFilter,
    sourceFilter,
    sourceOptions,
    statusFilter,
    tagFilter,
  };
}

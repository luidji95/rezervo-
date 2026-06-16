"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSalon } from "@/context/SalonContext";
import {
  deleteService,
  getSalonServices,
} from "@/services/serviceService";
import type { Service } from "@/types/service";
import { getAverageDuration, getServiceCategory } from "./serviceUtils";

export type ServiceStatusFilter = "all" | "active" | "inactive";
export type ServiceSortOption =
  | "name-asc"
  | "price-desc"
  | "duration-desc"
  | "popular-desc";

export function useServicesPageData() {
  const { currentSalon, salonLoading } = useSalon();

  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [statusFilter, setStatusFilter] =
    useState<ServiceStatusFilter>("all");
  const [sortOption, setSortOption] = useState<ServiceSortOption>("name-asc");

  const salonId = currentSalon?.id;

  const loadData = useCallback(async () => {
    if (!salonId) return;

    try {
      setLoading(true);

      const servicesData = await getSalonServices(salonId);

      setServices(servicesData);
      setSelectedService((current) => {
        if (current) {
          return (
            servicesData.find((service) => service.id === current.id) ??
            servicesData[0] ??
            null
          );
        }

        return servicesData[0] ?? null;
      });
    } catch (error) {
      console.error("Greška pri učitavanju usluga:", error);
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

  const categories = useMemo(() => {
    const counts = new Map<string, number>();

    services.forEach((service) => {
      const category = getServiceCategory(service);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });

    return Array.from(counts.entries()).map(([name, count]) => ({
      name,
      count,
    }));
  }, [services]);

  const filteredServices = useMemo(() => {
    const search = searchValue.toLowerCase();

    return services
      .filter((service) => {
        const matchesSearch =
          service.name.toLowerCase().includes(search) ||
          service.description?.toLowerCase().includes(search);

        const matchesCategory =
          selectedCategory === "all" ||
          getServiceCategory(service) === selectedCategory;

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" && service.is_active) ||
          (statusFilter === "inactive" && !service.is_active);

        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort((first, second) => {
        if (sortOption === "price-desc") {
          return Number(second.price) - Number(first.price);
        }

        if (sortOption === "duration-desc") {
          return second.duration_minutes - first.duration_minutes;
        }

        if (sortOption === "popular-desc") {
          return second.id.charCodeAt(0) - first.id.charCodeAt(0);
        }

        return first.name.localeCompare(second.name, "sr");
      });
  }, [searchValue, selectedCategory, services, sortOption, statusFilter]);

  const totalServices = services.length;
  const averageDuration = getAverageDuration(services);

  async function handleDeleteService(serviceId: string) {
    const confirmed = window.confirm(
      "Da li sigurno želiš da obrišeš ovu uslugu?"
    );

    if (!confirmed) return;

    try {
      await deleteService(serviceId);
      await loadData();
    } catch (error) {
      console.error("Greška pri brisanju usluge:", error);
    }
  }

  return {
    averageDuration,
    categories,
    currentSalon,
    filteredServices,
    handleDeleteService,
    loadData,
    loading,
    salonId,
    salonLoading,
    searchValue,
    selectedCategory,
    selectedService,
    services,
    setSearchValue,
    setSelectedCategory,
    setSelectedService,
    setSortOption,
    setStatusFilter,
    sortOption,
    statusFilter,
    totalServices,
  };
}

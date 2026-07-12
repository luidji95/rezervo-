"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSalon } from "@/context/SalonContext";
import {
  createEmptyServiceStats,
  getServiceAnalytics,
  type ServiceAnalytics,
  type ServiceKPIs,
  type ServiceStats,
} from "@/services/serviceAnalyticsService";
import {
  deleteServiceSafely,
  getSalonServices,
  restoreService,
} from "@/services/serviceService";
import type { Service } from "@/types/service";
import { getServiceCategory } from "./serviceUtils";

export type ServiceSortOption =
  | "name-asc"
  | "price-desc"
  | "duration-desc"
  | "popular-desc";

const emptyServiceKPIs: ServiceKPIs = {
  totalServices: 0,
  activeServices: 0,
  averagePrice: 0,
  averageDuration: 0,
};

export function useServicesPageData() {
  const { currentSalon, salonLoading } = useSalon();

  const [services, setServices] = useState<Service[]>([]);
  const [analytics, setAnalytics] = useState<ServiceAnalytics>({
    kpis: emptyServiceKPIs,
    statsByServiceId: {},
  });
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortOption, setSortOption] = useState<ServiceSortOption>("name-asc");
  const [showInactive, setShowInactive] = useState(false);

  const salonId = currentSalon?.id;

  const loadData = useCallback(async () => {
    if (!salonId) return;

    try {
      setLoading(true);

      const servicesData = await getSalonServices(salonId);
      const analyticsData = await getServiceAnalytics(salonId, servicesData);

      setServices(servicesData);
      setAnalytics(analyticsData);
      setSelectedService((current) => {
        const visibleServices = showInactive
          ? servicesData
          : servicesData.filter((service) => service.is_active);

        if (current) {
          return (
            visibleServices.find((service) => service.id === current.id) ??
            visibleServices[0] ??
            null
          );
        }

        return visibleServices[0] ?? null;
      });
    } catch (error) {
      console.error("Greška pri učitavanju usluga:", error);
    } finally {
      setLoading(false);
    }
  }, [salonId, showInactive]);

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

    services
      .filter((service) => showInactive || service.is_active)
      .forEach((service) => {
        const category = getServiceCategory(service);
        counts.set(category, (counts.get(category) ?? 0) + 1);
      });

    return Array.from(counts.entries()).map(([name, count]) => ({
      name,
      count,
    }));
  }, [services, showInactive]);

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

        const matchesStatus = showInactive || service.is_active;

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
          const firstStats =
            analytics.statsByServiceId[first.id] ?? createEmptyServiceStats();
          const secondStats =
            analytics.statsByServiceId[second.id] ?? createEmptyServiceStats();

          return secondStats.popularity - firstStats.popularity;
        }

        return first.name.localeCompare(second.name, "sr");
      });
  }, [
    analytics.statsByServiceId,
    searchValue,
    selectedCategory,
    services,
    showInactive,
    sortOption,
  ]);

  const selectedServiceStats = useMemo((): ServiceStats => {
    if (!selectedService) {
      return createEmptyServiceStats();
    }

    return analytics.statsByServiceId[selectedService.id] ?? createEmptyServiceStats();
  }, [analytics.statsByServiceId, selectedService]);

  async function handleDeleteService(service: Service) {
    if (!salonId) return;

    await deleteServiceSafely({
      serviceId: service.id,
      salonId,
    });
    await loadData();
  }

  async function handleRestoreService(service: Service) {
    if (!salonId) return;

    await restoreService({
      serviceId: service.id,
      salonId,
    });
    await loadData();
  }

  return {
    categories,
    currentSalon,
    filteredServices,
    handleDeleteService,
    handleRestoreService,
    loadData,
    loading,
    salonId,
    salonLoading,
    searchValue,
    selectedCategory,
    selectedService,
    selectedServiceStats,
    serviceKPIs: analytics.kpis,
    serviceStatsByServiceId: analytics.statsByServiceId,
    services,
    showInactive,
    setSearchValue,
    setSelectedCategory,
    setShowInactive,
    setSelectedService,
    setSortOption,
    sortOption,
  };
}

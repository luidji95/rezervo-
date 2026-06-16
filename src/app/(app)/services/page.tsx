"use client";

import { useState } from "react";
import {
  BarChart3,
  Clock,
  Euro,
  Plus,
  Scissors,
} from "lucide-react";

import type { Service } from "@/types/service";
import { AddServiceModal } from "./AddServiceModal";
import { KpiCard } from "./KpiCard";
import { ServiceDetailsPanel } from "./ServiceDetailsPanel";
import { ServiceTable } from "./ServiceTable";
import { useServicesPageData } from "./useServicesPageData";

import "./services.css";

export default function ServicesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const {
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
  } = useServicesPageData();

  function openCreateModal() {
    setEditingService(null);
    setIsModalOpen(true);
  }

  function openEditModal(service: Service) {
    setEditingService(service);
    setIsModalOpen(true);
  }

  if (salonLoading || loading) {
    return (
      <div className="services-page">
        <div className="services-card">
          <p>Učitavanje usluga...</p>
        </div>
      </div>
    );
  }

  if (!currentSalon || !salonId) {
    return (
      <div className="services-page">
        <div className="services-card">
          <p className="services-error">Salon nije pronađen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="services-page">
      <header className="services-header">
        <div>
          <h1>Usluge</h1>
          <p>Upravljajte ponudom salona, cenama, trajanjem i statusima.</p>
        </div>

        <button
          type="button"
          className="services-primary-btn"
          onClick={openCreateModal}
        >
          <Plus size={17} />
          Nova usluga
        </button>
      </header>

      <section className="service-kpi-grid">
        <KpiCard
          label="Ukupno usluga"
          value={String(totalServices)}
          icon={<Scissors size={18} />}
          muted="+2 nove ove nedelje"
        />
        <KpiCard
          label="Najpopularnija usluga"
          value="Šišanje"
          icon={<BarChart3 size={18} />}
          muted="45 termina ove nedelje"
        />
        <KpiCard
          label="Prosečno trajanje"
          value={`${averageDuration} min`}
          icon={<Clock size={18} />}
        />
        <KpiCard
          label="Ukupan prihod"
          value="€3.200"
          icon={<Euro size={18} />}
          muted="dummy"
        />
      </section>

      <div className="services-layout">
        <main className="services-main">
          <ServiceTable
            categories={categories}
            services={filteredServices}
            selectedCategory={selectedCategory}
            selectedService={selectedService}
            searchValue={searchValue}
            statusFilter={statusFilter}
            sortOption={sortOption}
            totalServices={services.length}
            onCategoryChange={setSelectedCategory}
            onDeleteService={(serviceId) => {
              void handleDeleteService(serviceId);
            }}
            onEditService={openEditModal}
            onSearchChange={setSearchValue}
            onSelectService={setSelectedService}
            onSortChange={setSortOption}
            onStatusFilterChange={setStatusFilter}
          />
        </main>

        <aside className="services-side">
          <ServiceDetailsPanel
            service={selectedService}
            onEditService={openEditModal}
          />
        </aside>
      </div>

      {isModalOpen && (
        <AddServiceModal
          salonId={salonId}
          categories={categories.map((category) => category.name)}
          editingService={editingService}
          onClose={() => {
            setIsModalOpen(false);
            setEditingService(null);
          }}
          onSaved={async () => {
            setIsModalOpen(false);
            setEditingService(null);
            await loadData();
          }}
        />
      )}
    </div>
  );
}

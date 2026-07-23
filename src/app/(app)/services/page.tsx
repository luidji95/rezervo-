"use client";

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Euro,
  Plus,
  Scissors,
} from "lucide-react";

import type { Service } from "@/types/service";
import { AddServiceModal } from "./AddServiceModal";
import { DeleteServiceModal } from "./DeleteServiceModal";
import { KpiCard } from "./KpiCard";
import { ServiceDetailsPanel } from "./ServiceDetailsPanel";
import { ServiceTable } from "./ServiceTable";
import { formatMoney } from "./serviceUtils";
import { useServicesPageData } from "./useServicesPageData";

import "./services.css";

export default function ServicesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deletingService, setDeletingService] = useState<Service | null>(null);
  const [isDeletingService, setIsDeletingService] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  const {
    categories,
    currentSalon,
    filteredServices,
    handleDeleteService,
    handleRestoreService,
    loadData,
    loadError,
    loading,
    salonId,
    salonLoading,
    searchValue,
    selectedCategory,
    selectedService,
    selectedServiceStats,
    serviceKPIs,
    serviceStatsByServiceId,
    services,
    showInactive,
    setSearchValue,
    setSelectedCategory,
    setSelectedService,
    setShowInactive,
    setSortOption,
    sortOption,
  } = useServicesPageData();

  function openCreateModal() {
    setEditingService(null);
    setIsModalOpen(true);
  }

  function openEditModal(service: Service) {
    setMobileDetailsOpen(false);
    setEditingService(service);
    setIsModalOpen(true);
  }

  const closeMobileDetails = useCallback(() => {
    setMobileDetailsOpen(false);
  }, []);

  function selectService(service: Service) {
    setSelectedService(service);
    if (window.matchMedia("(max-width: 767px)").matches) {
      setMobileDetailsOpen(true);
    }
  }

  async function confirmDeleteService() {
    if (!deletingService) return;

    setIsDeletingService(true);

    try {
      await handleDeleteService(deletingService);
      setDeletingService(null);
    } catch (error) {
      console.error("Greška pri brisanju usluge:", error);
    } finally {
      setIsDeletingService(false);
    }
  }

  if (salonLoading || loading) {
    return (
      <div className="services-page" aria-busy="true" aria-label="Učitavanje usluga">
        <div className="services-loading-header"><span /><span /></div>
        <div className="service-kpi-grid services-loading-kpis">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
        <div className="services-card services-loading-list">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
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

  if (loadError) {
    return (
      <div className="services-page">
        <section className="services-card services-load-error" role="alert">
          <h1>Usluge trenutno nisu dostupne</h1>
          <p>Pokušajte ponovo. Ostali delovi aplikacije ostaju dostupni.</p>
          <button type="button" className="services-primary-btn" onClick={() => void loadData()}>
            Pokušaj ponovo
          </button>
        </section>
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
          value={String(serviceKPIs.totalServices)}
          icon={<Scissors size={18} />}
          muted="Iz services tabele"
        />
        <KpiCard
          label="Aktivne usluge"
          value={String(serviceKPIs.activeServices)}
          icon={<CheckCircle2 size={18} />}
          muted="Status active"
        />
        <KpiCard
          label="Prosečna cena"
          value={formatMoney(serviceKPIs.averagePrice)}
          icon={<Euro size={18} />}
          muted="AVG(price)"
        />
        <KpiCard
          label="Prosečno trajanje"
          value={`${serviceKPIs.averageDuration} min`}
          icon={<Clock size={18} />}
          muted="AVG(duration)"
        />
      </section>

      <div className="services-layout">
        <main className="services-main">
          <ServiceTable
            categories={categories}
            services={filteredServices}
            selectedCategory={selectedCategory}
            selectedService={selectedService}
            serviceStatsByServiceId={serviceStatsByServiceId}
            showInactive={showInactive}
            searchValue={searchValue}
            sortOption={sortOption}
            totalServices={
              showInactive
                ? services.length
                : services.filter((service) => service.is_active).length
            }
            onCategoryChange={setSelectedCategory}
            onDeleteService={setDeletingService}
            onRestoreService={handleRestoreService}
            onSearchChange={setSearchValue}
            onSelectService={selectService}
            onShowInactiveChange={setShowInactive}
            onSortChange={setSortOption}
          />
        </main>

        <aside className="services-side">
          <ServiceDetailsPanel
            service={selectedService}
            stats={selectedServiceStats}
            mobileOpen={mobileDetailsOpen}
            onClose={closeMobileDetails}
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

      {deletingService && (
        <DeleteServiceModal
          service={deletingService}
          isDeleting={isDeletingService}
          onCancel={() => setDeletingService(null)}
          onConfirm={confirmDeleteService}
        />
      )}
    </div>
  );
}

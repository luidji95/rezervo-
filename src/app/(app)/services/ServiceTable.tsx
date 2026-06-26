"use client";

import {
  Scissors,
  Search,
} from "lucide-react";

import type { ServiceStats } from "@/services/serviceAnalyticsService";
import type { Service } from "@/types/service";
import {
  formatDuration,
  formatMoney,
  formatPrice,
} from "./serviceUtils";
import type {
  ServiceSortOption,
  ServiceStatusFilter,
} from "./useServicesPageData";

type ServiceTableProps = {
  categories: { name: string; count: number }[];
  services: Service[];
  selectedCategory: string;
  selectedService: Service | null;
  serviceStatsByServiceId: Record<string, ServiceStats>;
  searchValue: string;
  statusFilter: ServiceStatusFilter;
  sortOption: ServiceSortOption;
  totalServices: number;
  onCategoryChange: (category: string) => void;
  onSearchChange: (value: string) => void;
  onSelectService: (service: Service) => void;
  onSortChange: (value: ServiceSortOption) => void;
  onStatusFilterChange: (value: ServiceStatusFilter) => void;
};

export function ServiceTable({
  categories,
  services,
  selectedCategory,
  selectedService,
  serviceStatsByServiceId,
  searchValue,
  statusFilter,
  sortOption,
  totalServices,
  onCategoryChange,
  onSearchChange,
  onSelectService,
  onSortChange,
  onStatusFilterChange,
}: ServiceTableProps) {
  return (
    <section className="services-card">
      <div className="service-category-bar">
        <button
          type="button"
          className={selectedCategory === "all" ? "active" : ""}
          onClick={() => onCategoryChange("all")}
        >
          Sve usluge ({totalServices})
        </button>

        {categories.map((category) => (
          <button
            key={category.name}
            type="button"
            className={selectedCategory === category.name ? "active" : ""}
            onClick={() => onCategoryChange(category.name)}
          >
            {category.name} ({category.count})
          </button>
        ))}

        <button
          type="button"
          className="service-category-add"
          onClick={() => {
            window.alert("Kategorije usluga biće omogućene u sledećem koraku.");
          }}
        >
          Nova kategorija
        </button>
      </div>

      <div className="services-toolbar">
        <div className="services-search">
          <Search size={16} />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Pretraži usluge..."
          />
        </div>

        <select
          className="services-filter"
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(event.target.value as ServiceStatusFilter)
          }
        >
          <option value="all">Svi statusi</option>
          <option value="active">Aktivne</option>
          <option value="inactive">Neaktivne</option>
        </select>

        <select
          className="services-filter"
          value={sortOption}
          onChange={(event) =>
            onSortChange(event.target.value as ServiceSortOption)
          }
        >
          <option value="name-asc">Naziv A-Z</option>
          <option value="price-desc">Cena najskuplje</option>
          <option value="duration-desc">Trajanje</option>
          <option value="popular-desc">Popularnost</option>
        </select>
      </div>

      <div className="services-table">
        <div className="services-table-head">
          <span>Usluga</span>
          <span>Cena</span>
          <span>Trajanje</span>
          <span>Termini</span>
          <span>Prihod</span>
          <span>Status</span>
        </div>

        {services.length === 0 ? (
          <div className="services-empty">
            <p>Nema usluga za izabrane filtere.</p>
          </div>
        ) : (
          services.map((service) => {
            const isSelected = selectedService?.id === service.id;
            const stats = serviceStatsByServiceId[service.id];

            return (
              <div
                key={service.id}
                role="button"
                tabIndex={0}
                className={`services-table-row ${isSelected ? "active" : ""}`}
                onClick={() => onSelectService(service)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectService(service);
                  }
                }}
              >
                <div className="service-name-cell">
                  <div className="service-avatar">
                    <Scissors size={18} />
                  </div>

                  <div>
                    <strong>{service.name}</strong>
                    <span>{service.description || "Opis nije dodat"}</span>
                  </div>
                </div>

                <span>{formatPrice(service)}</span>
                <span>{formatDuration(service.duration_minutes)}</span>
                <span>{stats?.totalAppointments ?? 0}</span>
                <span>{formatMoney(stats?.revenue ?? 0)}</span>
                <span
                  className={`service-status-pill ${
                    service.is_active ? "active" : "inactive"
                  }`}
                >
                  {service.is_active ? "ON" : "OFF"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

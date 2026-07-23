"use client";

import {
  Clock,
  Euro,
  RotateCcw,
  Scissors,
  Search,
  Trash2,
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
} from "./useServicesPageData";

type ServiceTableProps = {
  categories: { name: string; count: number }[];
  services: Service[];
  selectedCategory: string;
  selectedService: Service | null;
  serviceStatsByServiceId: Record<string, ServiceStats>;
  showInactive: boolean;
  searchValue: string;
  sortOption: ServiceSortOption;
  totalServices: number;
  onCategoryChange: (category: string) => void;
  onDeleteService: (service: Service) => void;
  onRestoreService: (service: Service) => void;
  onSearchChange: (value: string) => void;
  onSelectService: (service: Service) => void;
  onShowInactiveChange: (value: boolean) => void;
  onSortChange: (value: ServiceSortOption) => void;
};

export function ServiceTable({
  categories,
  services,
  selectedCategory,
  selectedService,
  serviceStatsByServiceId,
  showInactive,
  searchValue,
  sortOption,
  totalServices,
  onCategoryChange,
  onDeleteService,
  onRestoreService,
  onSearchChange,
  onSelectService,
  onShowInactiveChange,
  onSortChange,
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

        <label className="services-toggle-filter">
          <input
            checked={showInactive}
            type="checkbox"
            onChange={(event) => onShowInactiveChange(event.target.checked)}
          />
          <span>Prikaži neaktivne</span>
        </label>

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
          <span>Akcije</span>
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
                className={`services-table-row ${isSelected ? "active" : ""} ${
                  service.is_active ? "" : "inactive"
                }`}
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
                  {service.is_active ? "ON" : "Neaktivna"}
                </span>

                <div className="service-actions-cell">
                  {service.is_active ? (
                    <button
                      type="button"
                      className="service-row-action danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteService(service);
                      }}
                    >
                      <Trash2 size={14} />
                      Obriši
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="service-row-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestoreService(service);
                      }}
                    >
                      <RotateCcw size={14} />
                      Vrati
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {services.length > 0 && (
        <div className="services-mobile-list" aria-label="Lista usluga">
          {services.map((service) => {
            const stats = serviceStatsByServiceId[service.id];

            return (
              <article
                key={service.id}
                className={`service-mobile-card ${
                  service.is_active ? "" : "inactive"
                }`}
              >
                <button
                  type="button"
                  className="service-mobile-card-main"
                  onClick={() => onSelectService(service)}
                  aria-label={`Otvori detalje usluge ${service.name}`}
                >
                  <span className="service-mobile-card-heading">
                    <span className="service-avatar" aria-hidden="true">
                      <Scissors size={18} />
                    </span>
                    <span>
                      <strong>{service.name}</strong>
                      <span>{service.category_name || "Bez kategorije"}</span>
                    </span>
                    <span
                      className={`service-status-pill ${
                        service.is_active ? "active" : "inactive"
                      }`}
                    >
                      {service.is_active ? "Aktivna" : "Neaktivna"}
                    </span>
                  </span>

                  {service.description && (
                    <span className="service-mobile-description">
                      {service.description}
                    </span>
                  )}

                  <span className="service-mobile-metrics">
                    <span>
                      <Euro size={15} aria-hidden="true" />
                      <small>Osnovna cena</small>
                      <strong>{formatPrice(service)}</strong>
                    </span>
                    <span>
                      <Clock size={15} aria-hidden="true" />
                      <small>Trajanje</small>
                      <strong>{formatDuration(service.duration_minutes)}</strong>
                    </span>
                    <span>
                      <Scissors size={15} aria-hidden="true" />
                      <small>Termini</small>
                      <strong>{stats?.totalAppointments ?? 0}</strong>
                    </span>
                  </span>
                </button>

                <div className="service-mobile-actions">
                  <button
                    type="button"
                    className="services-secondary-btn"
                    onClick={() => onSelectService(service)}
                  >
                    Detalji i izmena
                  </button>
                  {service.is_active ? (
                    <button
                      type="button"
                      className="service-row-action danger"
                      onClick={() => onDeleteService(service)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Obriši
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="service-row-action"
                      onClick={() => onRestoreService(service)}
                    >
                      <RotateCcw size={15} aria-hidden="true" />
                      Vrati
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

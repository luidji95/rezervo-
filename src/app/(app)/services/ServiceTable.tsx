"use client";

import {
  Eye,
  MoreVertical,
  Pencil,
  Scissors,
  Search,
  Trash2,
} from "lucide-react";

import type { Service } from "@/types/service";
import {
  formatDuration,
  formatPrice,
  getDummyPopularity,
  getServiceCategory,
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
  searchValue: string;
  statusFilter: ServiceStatusFilter;
  sortOption: ServiceSortOption;
  totalServices: number;
  onCategoryChange: (category: string) => void;
  onDeleteService: (serviceId: string) => void;
  onEditService: (service: Service) => void;
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
  searchValue,
  statusFilter,
  sortOption,
  totalServices,
  onCategoryChange,
  onDeleteService,
  onEditService,
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
          <span></span>
          <span>Usluga</span>
          <span>Kategorija</span>
          <span>Trajanje</span>
          <span>Cena</span>
          <span>Popularnost</span>
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
            const popularity = getDummyPopularity(service.id);

            return (
              <button
                key={service.id}
                type="button"
                className={`services-table-row ${isSelected ? "active" : ""}`}
                onClick={() => onSelectService(service)}
              >
                <span
                  className="service-checkbox"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input type="checkbox" aria-label="Izaberi uslugu" />
                </span>

                <div className="service-name-cell">
                  <div className="service-avatar">
                    <Scissors size={18} />
                  </div>

                  <div>
                    <strong>{service.name}</strong>
                    <span>{service.description || "Opis nije dodat"}</span>
                  </div>
                </div>

                <span className="service-category-pill">
                  {getServiceCategory(service)}
                </span>
                <span>{formatDuration(service.duration_minutes)}</span>
                <span>{formatPrice(service)}</span>
                <span>{popularity} ove nedelje</span>
                <span
                  className={`service-status-pill ${
                    service.is_active ? "active" : "inactive"
                  }`}
                >
                  {service.is_active ? "ON" : "OFF"}
                </span>

                <div className="service-actions-cell">
                  <span className="service-icon-btn">
                    <Eye size={15} />
                  </span>

                  <span
                    className="service-icon-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditService(service);
                    }}
                  >
                    <Pencil size={15} />
                  </span>

                  <span
                    className="service-icon-btn danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteService(service.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </span>

                  <span className="service-icon-btn">
                    <MoreVertical size={15} />
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

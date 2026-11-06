"use client";

import { Check, Scissors } from "lucide-react";
import { useMemo, useState } from "react";
import { formatPrice, getServiceCategoryFilters } from "../publicBookingFormat";
import type { PublicSalon, PublicService } from "../types";

type Props = {
  salon: PublicSalon;
  services: PublicService[];
  selectedServiceId: string | null;
  onSelectService: (serviceId: string) => void;
};

function safeImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function PublicSalonIdentity({ salon }: { salon: PublicSalon }) {
  const logoUrl = safeImageUrl(salon.logoUrl);
  const location = [salon.addressLine, salon.city].filter(Boolean).join(", ");
  return (
    <div className="pb-salon">
      <div className="pb-salon-mark" aria-hidden="true">
        {logoUrl ? (
          // The image host is salon-managed and cannot be enumerated in Next config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" />
        ) : <Scissors size={24} />}
      </div>
      <div>
        <p className="pb-salon-name">{salon.name}</p>
        {location && <p className="pb-salon-address">{location}</p>}
      </div>
    </div>
  );
}

export function PublicServiceStep({ salon, services, selectedServiceId, onSelectService }: Props) {
  const filters = useMemo(() => getServiceCategoryFilters(services), [services]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const visible = activeFilter ? services.filter((service) => service.categoryId === activeFilter) : services;

  return (
    <section className="pb-step" aria-labelledby="pb-service-title">
      <PublicSalonIdentity salon={salon} />
      <h1 className="pb-title" id="pb-service-title">Izaberite uslugu</h1>

      {filters.length > 0 && (
        <div className="pb-chips" role="group" aria-label="Kategorije usluga">
          <button type="button" className={`pb-chip${activeFilter === null ? " is-active" : ""}`} aria-pressed={activeFilter === null} onClick={() => setActiveFilter(null)}>Sve</button>
          {filters.map((filter) => (
            <button type="button" key={filter.id} className={`pb-chip${activeFilter === filter.id ? " is-active" : ""}`} aria-pressed={activeFilter === filter.id} onClick={() => setActiveFilter(filter.id)}>
              {filter.name}
            </button>
          ))}
        </div>
      )}

      {services.length === 0 ? (
        <div className="pb-empty" role="status">
          <strong>Trenutno nema dostupnih usluga</strong>
          <span>Salon još nema objavljene usluge za online zakazivanje.</span>
        </div>
      ) : (
        <div className="pb-options" role="radiogroup" aria-labelledby="pb-service-title">
          {visible.map((service) => {
            const selected = service.id === selectedServiceId;
            return (
              <button type="button" role="radio" aria-checked={selected} key={service.id} className={`pb-service${selected ? " is-selected" : ""}`} onClick={() => onSelectService(service.id)}>
                <span className="pb-radio" aria-hidden="true">{selected && <Check size={14} strokeWidth={3} />}</span>
                <span className="pb-service-text">
                  <strong>{service.name}</strong>
                  <span>{service.durationMinutes} min</span>
                </span>
                <span className="pb-service-price">{formatPrice(service.price, service.currency)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

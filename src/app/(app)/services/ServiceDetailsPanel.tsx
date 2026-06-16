import { Clock, Euro, Scissors, Star, TrendingUp } from "lucide-react";

import type { Service } from "@/types/service";
import {
  SERVICE_INCLUDED_ITEMS,
  formatDuration,
  formatPrice,
  getDummyPopularity,
  getServiceCategory,
} from "./serviceUtils";

type ServiceDetailsPanelProps = {
  service: Service | null;
  onEditService: (service: Service) => void;
};

export function ServiceDetailsPanel({
  service,
  onEditService,
}: ServiceDetailsPanelProps) {
  if (!service) {
    return (
      <section className="services-card service-details-empty">
        <p>Izaberi uslugu iz liste za pregled detalja.</p>
      </section>
    );
  }

  return (
    <section className="services-card service-details-card">
      <div className="service-details-header">
        <div className="service-details-avatar">
          <Scissors size={24} />
        </div>

        <div>
          <h3>{service.name}</h3>
          <span
            className={`service-status-pill ${
              service.is_active ? "active" : "inactive"
            }`}
          >
            {service.is_active ? "Aktivna" : "Neaktivna"}
          </span>
        </div>
      </div>

      <div className="service-info-list">
        <InfoRow
          icon={<Clock size={15} />}
          label="Trajanje"
          value={formatDuration(service.duration_minutes)}
        />
        <InfoRow
          icon={<Euro size={15} />}
          label="Cena"
          value={formatPrice(service)}
        />
        <InfoRow
          icon={<Scissors size={15} />}
          label="Kategorija"
          value={getServiceCategory(service)}
        />
        <InfoRow
          icon={<TrendingUp size={15} />}
          label="Popularnost"
          value={`${getDummyPopularity(service.id)} termina ove nedelje`}
        />
      </div>

      <div className="service-section">
        <h4>Opis</h4>
        <p className="service-muted-text">
          {service.description || "Opis usluge još nije dodat."}
        </p>
      </div>

      <div className="service-section">
        <h4>Uključuje</h4>
        <div className="service-included-list">
          {SERVICE_INCLUDED_ITEMS.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>

      <div className="service-section">
        <h4>Statistika</h4>
        <div className="service-stats-grid">
          <MiniStat label="Ukupno" value="128" />
          <MiniStat label="Prihod" value="€3.200" />
          <MiniStat label="Ocena" value="4.9" icon={<Star size={13} />} />
        </div>
      </div>

      <button
        type="button"
        className="services-primary-btn full-width"
        onClick={() => onEditService(service)}
      >
        Izmeni uslugu
      </button>
    </section>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="service-info-row">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="service-mini-stat">
      <span>{label}</span>
      <strong>
        {value}
        {icon}
      </strong>
    </div>
  );
}

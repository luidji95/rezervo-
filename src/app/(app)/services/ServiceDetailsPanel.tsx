import { CalendarCheck, Clock, Euro, Scissors, TrendingUp } from "lucide-react";

import type { ServiceStats } from "@/services/serviceAnalyticsService";
import type { Service } from "@/types/service";
import {
  formatDuration,
  formatMoney,
  formatPrice,
  formatServiceDate,
  getServiceCategory,
} from "./serviceUtils";

type ServiceDetailsPanelProps = {
  service: Service | null;
  stats: ServiceStats;
  onEditService: (service: Service) => void;
};

export function ServiceDetailsPanel({
  service,
  stats,
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

      <div className="service-section">
        <h4>Opis</h4>
        <p className="service-muted-text">
          {service.description || "Opis usluge još nije dodat."}
        </p>
      </div>

      <div className="service-section">
        <h4>Osnovne informacije</h4>
        <div className="service-info-list compact">
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
        </div>
      </div>

      <div className="service-section">
        <h4>Analitika</h4>
        <div className="service-stats-grid">
          <MiniStat label="Broj termina" value={String(stats.totalAppointments)} />
          <MiniStat
            label="Completed"
            value={String(stats.completedAppointments)}
          />
          <MiniStat label="Prihod" value={formatMoney(stats.revenue)} />
          <MiniStat
            label="Prosek"
            value={formatMoney(stats.averageAppointmentValue)}
          />
          <MiniStat
            label="Popularnost"
            value={`${stats.popularity} (${stats.popularityPercent}%)`}
          />
        </div>
      </div>

      <div className="service-section">
        <h4>Istorija</h4>
        <div className="service-info-list compact">
          <InfoRow
            icon={<CalendarCheck size={15} />}
            label="Poslednja rezervacija"
            value={formatServiceDate(stats.lastBookedAt)}
          />
          <InfoRow
            icon={<TrendingUp size={15} />}
            label="Completed"
            value={String(stats.completedAppointments)}
          />
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
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="service-mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { CalendarCheck, Clock, Euro, Scissors, TrendingUp, X } from "lucide-react";

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
  canMutate: boolean;
  service: Service | null;
  stats: ServiceStats;
  mobileOpen: boolean;
  onClose: () => void;
  onEditService: (service: Service) => void;
};

export function ServiceDetailsPanel({
  canMutate,
  service,
  stats,
  mobileOpen,
  onClose,
  onEditService,
}: ServiceDetailsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileOpen || !service) return;

    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = panel?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [mobileOpen, onClose, service]);

  if (!service) {
    return (
      <section className="services-card service-details-empty">
        <p>Izaberi uslugu iz liste za pregled detalja.</p>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className={`services-card service-details-card ${mobileOpen ? "mobile-open" : ""}`}
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen ? true : undefined}
      aria-labelledby="service-details-title"
    >
      <button
        type="button"
        className="service-details-close"
        onClick={onClose}
        aria-label="Zatvori detalje usluge"
      >
        <X size={20} />
      </button>
      <div className="service-details-header">
        <div className="service-details-avatar">
          <Scissors size={24} />
        </div>

        <div>
          <h3 id="service-details-title">{service.name}</h3>
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
        disabled={!canMutate}
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

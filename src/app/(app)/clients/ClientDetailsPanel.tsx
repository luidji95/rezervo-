"use client";

import { CalendarPlus, Mail, Phone, Sparkles } from "lucide-react";

import type { ClientMetrics } from "@/services/clientAnalyticsService";
import type { Client } from "@/types/client";
import {
  formatClientDate,
  formatMoney,
  getClientInitials,
  getClientSourceLabel,
} from "./clientUtils";

type ClientDetailsPanelProps = {
  client: Client | null;
  metrics: ClientMetrics;
};

export function ClientDetailsPanel({ client, metrics }: ClientDetailsPanelProps) {
  if (!client) {
    return (
      <section className="clients-card client-details-empty">
        <p>Izaberite klijenta za detaljan CRM pregled.</p>
      </section>
    );
  }

  return (
    <section className="clients-card client-details">
      <div className="client-details-header">
        <div className="client-details-avatar">
          {getClientInitials(client) || "KL"}
        </div>

        <div>
          <h3>{client.full_name}</h3>
          <span className="client-source-pill">
            Izvor: {getClientSourceLabel(client.source)}
          </span>
        </div>
      </div>

      <div className="client-info-list">
        <div className="client-info-row">
          <Phone size={16} />
          <span>Telefon</span>
          <strong>{client.phone || "Nije unet"}</strong>
        </div>

        <div className="client-info-row">
          <Mail size={16} />
          <span>Email</span>
          <strong>{client.email || "Nije unet"}</strong>
        </div>

        <div className="client-info-row">
          <Sparkles size={16} />
          <span>Prvi dolazak</span>
          <strong>{formatClientDate(client.created_at)}</strong>
        </div>
      </div>

      <div className="client-section">
        <h4>Omiljene usluge</h4>
        {metrics.favoriteServices.length === 0 ? (
          <p className="client-muted-text">Nema zavrsenih usluga za ovog klijenta.</p>
        ) : (
          <div className="client-chip-row">
            {metrics.favoriteServices.map((service) => (
              <span key={service.serviceId}>
                {service.name} ({service.count})
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="client-section">
        <h4>Istorija poseta</h4>
        {metrics.history.length === 0 ? (
          <p className="client-muted-text">Nema zavrsenih poseta.</p>
        ) : (
          <div className="client-history-list">
            {metrics.history.map((appointment) => (
              <div key={appointment.id}>
                <span>{formatClientDate(appointment.startTime)}</span>
                <strong>{appointment.serviceName}</strong>
                <em>{formatMoney(appointment.price)}</em>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="client-stats-grid">
        <div className="client-mini-stat">
          <span>Ukupno poseta</span>
          <strong>{metrics.visits}</strong>
        </div>
        <div className="client-mini-stat">
          <span>Ukupno potroseno</span>
          <strong>{formatMoney(metrics.totalSpent)}</strong>
        </div>
        <div className="client-mini-stat">
          <span>Prosecno</span>
          <strong>{formatMoney(metrics.averageSpent)}</strong>
        </div>
      </div>

      <button
        type="button"
        className="clients-primary-btn full-width"
        onClick={() => {
          window.alert("Novi termin za klijenta bice omogucen u sledecem koraku.");
        }}
      >
        <CalendarPlus size={16} />
        Novi termin za klijenta
      </button>
    </section>
  );
}

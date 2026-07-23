"use client";

import { CalendarPlus, Mail, Phone, Sparkles } from "lucide-react";

import type { ClientPageItem } from "@/features/clients/types";
import {
  formatClientDate,
  formatMoney,
  getClientSourceLabel,
} from "./clientUtils";

type ClientDetailsPanelProps = {
  client: ClientPageItem | null;
};

export function ClientDetailsPanel({ client }: ClientDetailsPanelProps) {
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
          {client.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "KL"}
        </div>

        <div>
          <h3>{client.fullName}</h3>
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
          <strong>{formatClientDate(client.createdAt)}</strong>
        </div>
      </div>

      <div className="client-section">
        <h4>Omiljene usluge</h4>
        {!client.favoriteService ? (
          <p className="client-muted-text">Nema zavrsenih usluga za ovog klijenta.</p>
        ) : (
          <div className="client-chip-row">
            <span>{client.favoriteService.name} ({client.favoriteService.count})</span>
          </div>
        )}
      </div>

      <div className="client-section">
        <h4>Istorija poseta</h4>
        {client.recentVisits.length === 0 ? (
          <p className="client-muted-text">Nema zavrsenih poseta.</p>
        ) : (
          <div className="client-history-list">
            {client.recentVisits.map((appointment) => (
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
          <strong>{client.completedVisits}</strong>
        </div>
        <div className="client-mini-stat">
          <span>Ukupno potroseno</span>
          <strong>{formatMoney(client.completedRevenue)}</strong>
        </div>
        <div className="client-mini-stat">
          <span>Prosecno</span>
          <strong>{formatMoney(client.completedVisits > 0 ? client.completedRevenue / client.completedVisits : 0)}</strong>
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

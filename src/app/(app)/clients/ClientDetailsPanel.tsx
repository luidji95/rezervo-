"use client";

import { CalendarPlus, Mail, Phone, Sparkles } from "lucide-react";

import type { Client } from "@/types/client";
import {
  formatClientDate,
  formatMoney,
  getClientInitials,
  getClientStatusLabel,
  getClientStatus,
  getDummyFavoriteService,
  getDummySpent,
  getDummyTag,
  getDummyVisits,
} from "./clientUtils";

type ClientDetailsPanelProps = {
  client: Client | null;
};

export function ClientDetailsPanel({ client }: ClientDetailsPanelProps) {
  if (!client) {
    return (
      <section className="clients-card client-details-empty">
        <p>Izaberite klijenta za detaljan CRM pregled.</p>
      </section>
    );
  }

  const visits = getDummyVisits(client.id);
  const spent = getDummySpent(client.id);
  const averageSpend = spent / visits;

  return (
    <section className="clients-card client-details">
      <div className="client-details-header">
        <div className="client-details-avatar">
          {getClientInitials(client) || "KL"}
        </div>

        <div>
          <h3>{client.full_name}</h3>
          <span className={`client-status-pill ${getClientStatus(client)}`}>
            {getClientStatusLabel(client)}
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

      <div className="client-tag-row">
        <span>{getDummyTag(client.id)}</span>
        <span>{visits > 8 ? "Veran klijent" : "Novi klijent"}</span>
      </div>

      <div className="client-section">
        <h4>Omiljene usluge</h4>
        <div className="client-chip-row">
          <span>{getDummyFavoriteService(client.id)}</span>
          <span>Brada</span>
          <span>Pramenovi</span>
        </div>
      </div>

      <div className="client-section">
        <h4>Napomena</h4>
        <div className="client-note">
          Preferira popodnevne termine. Alergija na odredjene proizvode.
        </div>
      </div>

      <div className="client-section">
        <h4>Istorija poseta</h4>
        <div className="client-history-list">
          <div>
            <span>16.05.2025</span>
            <strong>Sisanje</strong>
            <em>€25</em>
          </div>
          <div>
            <span>02.05.2025</span>
            <strong>Brada</strong>
            <em>€15</em>
          </div>
          <div>
            <span>18.04.2025</span>
            <strong>Pramenovi</strong>
            <em>€60</em>
          </div>
        </div>
      </div>

      <div className="client-stats-grid">
        <div className="client-mini-stat">
          <span>Ukupno poseta</span>
          <strong>{visits}</strong>
        </div>
        <div className="client-mini-stat">
          <span>Ukupno potroseno</span>
          <strong>{formatMoney(spent)}</strong>
        </div>
        <div className="client-mini-stat">
          <span>Prosecno</span>
          <strong>{formatMoney(Number(averageSpend.toFixed(2)))}</strong>
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

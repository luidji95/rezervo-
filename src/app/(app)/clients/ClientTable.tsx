"use client";

import {
  Eye,
  Filter,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";

import type { Client } from "@/types/client";
import {
  formatMoney,
  getClientInitials,
  getClientStatusLabel,
  getClientSourceLabel,
  getClientStatus,
  getDummyFavoriteService,
  getDummyLastVisit,
  getDummySpent,
  getDummyVisits,
} from "./clientUtils";
import type { ClientStatusFilter } from "./useClientsPageData";

type ClientTableProps = {
  clients: Client[];
  selectedClient: Client | null;
  searchValue: string;
  sourceFilter: string;
  sourceOptions: string[];
  statusFilter: ClientStatusFilter;
  tagFilter: string;
  onDeleteClient: (clientId: string) => void;
  onEditClient: (client: Client) => void;
  onSearchChange: (value: string) => void;
  onSelectClient: (client: Client) => void;
  onSourceFilterChange: (value: string) => void;
  onStatusFilterChange: (value: ClientStatusFilter) => void;
  onTagFilterChange: (value: string) => void;
};

export function ClientTable({
  clients,
  selectedClient,
  searchValue,
  sourceFilter,
  sourceOptions,
  statusFilter,
  tagFilter,
  onDeleteClient,
  onEditClient,
  onSearchChange,
  onSelectClient,
  onSourceFilterChange,
  onStatusFilterChange,
  onTagFilterChange,
}: ClientTableProps) {
  return (
    <section className="clients-card">
      <div className="clients-toolbar">
        <div className="clients-search">
          <Search size={16} />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Pretrazi po imenu, telefonu ili emailu..."
          />
        </div>

        <select
          className="clients-filter"
          value={sourceFilter}
          onChange={(event) => onSourceFilterChange(event.target.value)}
        >
          <option value="all">Svi izvori</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>

        <select
          className="clients-filter"
          value={tagFilter}
          onChange={(event) => onTagFilterChange(event.target.value)}
        >
          <option value="all">Svi tagovi</option>
          <option value="VIP">VIP</option>
          <option value="Veran klijent">Veran klijent</option>
          <option value="Rizican">Rizican</option>
        </select>

        <select
          className="clients-filter"
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(event.target.value as ClientStatusFilter)
          }
        >
          <option value="all">Svi klijenti</option>
          <option value="active">Aktivni</option>
          <option value="inactive">Neaktivni</option>
        </select>

        <button
          type="button"
          className="clients-filter-btn"
          onClick={() => {
            window.alert("Napredni filteri bice omoguceni u sledecem koraku.");
          }}
        >
          <Filter size={15} />
          Filteri
        </button>
      </div>

      <div className="clients-table">
        <div className="clients-table-head">
          <span>Avatar</span>
          <span>Klijent</span>
          <span>Kontakt</span>
          <span>Posete</span>
          <span>Poslednja poseta</span>
          <span>Omiljena usluga</span>
          <span>Potroseno</span>
          <span>Status</span>
          <span>Akcije</span>
        </div>

        {clients.length === 0 ? (
          <div className="clients-empty">
            <p>Nema klijenata za izabrane filtere.</p>
          </div>
        ) : (
          clients.map((client) => {
            const isSelected = selectedClient?.id === client.id;

            return (
              <div
                key={client.id}
                role="button"
                tabIndex={0}
                className={`clients-table-row ${isSelected ? "active" : ""}`}
                onClick={() => onSelectClient(client)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectClient(client);
                  }
                }}
              >
                <div className="client-avatar">
                  {getClientInitials(client) || "KL"}
                </div>

                <div className="client-name-cell">
                  <strong>{client.full_name}</strong>
                  <span>{client.phone || "Telefon nije unet"}</span>
                </div>

                <span>{client.email || "Email nije unet"}</span>
                <span>{getDummyVisits(client.id)}</span>
                <span>{getDummyLastVisit(client.id)}<small>09:00</small></span>
                <span>{getDummyFavoriteService(client.id)}</span>
                <span>{formatMoney(getDummySpent(client.id))}</span>
                <span
                  className={`client-status-pill ${getClientStatus(client)}`}
                  title={getClientSourceLabel(client.source)}
                >
                  {getClientStatusLabel(client)}
                </span>

                <div className="client-actions-cell">
                  <button
                    type="button"
                    className="client-icon-btn"
                    aria-label="Pregled klijenta"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectClient(client);
                    }}
                  >
                    <Eye size={15} />
                  </button>

                  <button
                    type="button"
                    className="client-icon-btn"
                    aria-label="Izmeni klijenta"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditClient(client);
                    }}
                  >
                    <Pencil size={15} />
                  </button>

                  <button
                    type="button"
                    className="client-icon-btn"
                    aria-label="Dodatne akcije"
                    onClick={(event) => {
                      event.stopPropagation();
                      window.alert("Dodatne akcije dolaze kasnije.");
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>

                  <button
                    type="button"
                    className="client-icon-btn danger"
                    aria-label="Obrisi klijenta"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteClient(client.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="clients-pagination">
        <button type="button">&lt;&lt;</button>
        <button type="button">&lt;</button>
        <button type="button" className="active">1</button>
        <button type="button">2</button>
        <button type="button">3</button>
        <button type="button">4</button>
        <button type="button">&gt;</button>
        <button type="button">&gt;&gt;</button>
      </div>
    </section>
  );
}

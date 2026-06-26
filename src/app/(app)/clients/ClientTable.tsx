"use client";

import { useMemo, useState } from "react";
import {
  Eye,
  Filter,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";

import type { ClientMetrics } from "@/services/clientAnalyticsService";
import type { Client } from "@/types/client";
import {
  formatClientDate,
  formatMoney,
  getClientInitials,
} from "./clientUtils";

const CLIENTS_PER_PAGE = 10;

type ClientTableProps = {
  clients: Client[];
  metricsByClientId: Record<string, ClientMetrics>;
  selectedClient: Client | null;
  searchValue: string;
  sourceFilter: string;
  sourceOptions: string[];
  onDeleteClient: (clientId: string) => void;
  onEditClient: (client: Client) => void;
  onSearchChange: (value: string) => void;
  onSelectClient: (client: Client) => void;
  onSourceFilterChange: (value: string) => void;
};

export function ClientTable({
  clients,
  metricsByClientId,
  selectedClient,
  searchValue,
  sourceFilter,
  sourceOptions,
  onDeleteClient,
  onEditClient,
  onSearchChange,
  onSelectClient,
  onSourceFilterChange,
}: ClientTableProps) {
  const paginationScope = `${searchValue}\u0000${sourceFilter}`;
  const [pagination, setPagination] = useState({
    page: 1,
    scope: paginationScope,
  });
  const totalPages = Math.max(1, Math.ceil(clients.length / CLIENTS_PER_PAGE));
  const currentPage =
    pagination.scope === paginationScope
      ? Math.min(pagination.page, totalPages)
      : 1;
  const paginatedClients = useMemo(() => {
    const startIndex = (currentPage - 1) * CLIENTS_PER_PAGE;

    return clients.slice(startIndex, startIndex + CLIENTS_PER_PAGE);
  }, [clients, currentPage]);

  const pageNumbers = useMemo(() => {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }, [totalPages]);
  const goToPage = (page: number) => {
    setPagination({
      page,
      scope: paginationScope,
    });
  };

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
          <span>Posete</span>
          <span>Poslednja poseta</span>
          <span>Potroseno</span>
          <span>Akcije</span>
        </div>

        {clients.length === 0 ? (
          <div className="clients-empty">
            <p>Nema klijenata za izabrane filtere.</p>
          </div>
        ) : (
          paginatedClients.map((client) => {
            const isSelected = selectedClient?.id === client.id;
            const metrics = metricsByClientId[client.id];

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

                <span>{metrics?.visits ?? 0}</span>
                <span>
                  {metrics?.lastVisitAt
                    ? formatClientDate(metrics.lastVisitAt)
                    : "Nema poseta"}
                </span>
                <span>{formatMoney(metrics?.totalSpent ?? 0)}</span>

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

      {clients.length > CLIENTS_PER_PAGE ? (
        <div className="clients-pagination">
          <span>
            Strana {currentPage} od {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => goToPage(1)}
          >
            &lt;&lt;
          </button>
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => goToPage(Math.max(1, currentPage - 1))}
          >
            &lt;
          </button>
          {pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              className={page === currentPage ? "active" : ""}
              onClick={() => goToPage(page)}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
          >
            &gt;
          </button>
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => goToPage(totalPages)}
          >
            &gt;&gt;
          </button>
        </div>
      ) : null}
    </section>
  );
}

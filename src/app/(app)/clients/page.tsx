"use client";

import { useState } from "react";
import { CalendarCheck, Euro, Plus, TrendingUp, Users } from "lucide-react";

import type { Client } from "@/types/client";
import { AddClientModal } from "./AddClientModal";
import { ClientDetailsPanel } from "./ClientDetailsPanel";
import { ClientTable } from "./ClientTable";
import { KpiCard } from "./KpiCard";
import { useClientsPageData } from "./useClientsPageData";

import "./clients.css";

export default function ClientsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const {
    clients,
    currentSalon,
    filteredClients,
    handleDeleteClient,
    loadData,
    loading,
    newClientsThisMonth,
    salonId,
    salonLoading,
    searchValue,
    selectedClient,
    setSearchValue,
    setSelectedClient,
    setSourceFilter,
    setStatusFilter,
    setTagFilter,
    sourceFilter,
    sourceOptions,
    statusFilter,
    tagFilter,
  } = useClientsPageData();

  function openCreateModal() {
    setEditingClient(null);
    setIsModalOpen(true);
  }

  function openEditModal(client: Client) {
    setEditingClient(client);
    setIsModalOpen(true);
  }

  if (salonLoading || loading) {
    return (
      <div className="clients-page">
        <div className="clients-card">
          <p>Ucitavanje klijenata...</p>
        </div>
      </div>
    );
  }

  if (!currentSalon || !salonId) {
    return (
      <div className="clients-page">
        <div className="clients-card">
          <p className="clients-error">Salon nije pronadjen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="clients-page">
      <header className="clients-header">
        <div>
          <h1>Klijenti</h1>
          <p>CRM pregled kontakata, poseta, statusa i vrednosti klijenata.</p>
        </div>

        <button
          type="button"
          className="clients-primary-btn"
          onClick={openCreateModal}
        >
          <Plus size={17} />
          Novi klijent
        </button>
      </header>

      <section className="client-kpi-grid">
        <KpiCard
          label="Ukupno klijenata"
          value={String(clients.length)}
          icon={<Users size={18} />}
          muted="18% vs prosli mesec"
        />
        <KpiCard
          label="Novi klijenti"
          value={String(newClientsThisMonth)}
          icon={<TrendingUp size={18} />}
          muted="27% dummy"
        />
        <KpiCard
          label="Posete ovog meseca"
          value="146"
          icon={<CalendarCheck size={18} />}
          muted="dummy"
        />
        <KpiCard
          label="Vraceni klijenti"
          value="78%"
          icon={<Users size={18} />}
          muted="dummy"
        />
        <KpiCard
          label="Prihod od klijenata"
          value="€8.420"
          icon={<Euro size={18} />}
          muted="dummy"
        />
      </section>

      <div className="clients-layout">
        <main className="clients-main">
          <ClientTable
            clients={filteredClients}
            selectedClient={selectedClient}
            searchValue={searchValue}
            sourceFilter={sourceFilter}
            sourceOptions={sourceOptions}
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            onDeleteClient={(clientId) => {
              void handleDeleteClient(clientId);
            }}
            onEditClient={openEditModal}
            onSearchChange={setSearchValue}
            onSelectClient={setSelectedClient}
            onSourceFilterChange={setSourceFilter}
            onStatusFilterChange={setStatusFilter}
            onTagFilterChange={setTagFilter}
          />
        </main>

        <aside className="clients-side">
          <ClientDetailsPanel client={selectedClient} />
        </aside>
      </div>

      {isModalOpen && (
        <AddClientModal
          salonId={salonId}
          editingClient={editingClient}
          onClose={() => {
            setIsModalOpen(false);
            setEditingClient(null);
          }}
          onSaved={async () => {
            setIsModalOpen(false);
            setEditingClient(null);
            await loadData();
          }}
        />
      )}
    </div>
  );
}

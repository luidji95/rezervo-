"use client";

import { useState } from "react";
import { CalendarCheck, Euro, Plus, RefreshCw, TrendingUp, Users } from "lucide-react";
import type { ClientPageItem } from "@/features/clients/types";
import type { Client } from "@/types/client";
import { AddClientModal } from "./AddClientModal";
import { ClientDetailsPanel } from "./ClientDetailsPanel";
import { ClientTable } from "./ClientTable";
import { KpiCard } from "./KpiCard";
import { formatMoney } from "./clientUtils";
import { useClientsPageData } from "./useClientsPageData";
import "./clients.css";

function editableClient(client: ClientPageItem): Client {
  return { id: client.id, salon_id: client.salonId, full_name: client.fullName, phone: client.phone, email: client.email, source: client.source, created_at: client.createdAt, status: client.status as Client["status"] };
}

export default function ClientsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const clients = useClientsPageData();
  if (clients.salonLoading || (clients.loading && clients.result.items.length === 0)) return <div className="clients-page"><div className="clients-card clients-page__skeleton" aria-label="Učitavanje klijenata" /></div>;
  if (!clients.currentSalon || !clients.salonId) return <div className="clients-page"><div className="clients-card"><p className="clients-error">Salon nije pronađen.</p></div></div>;
  const kpis = clients.result.kpis;
  return <div className="clients-page">
    <header className="clients-header"><div><h1>Klijenti</h1><p>CRM pregled kontakata, poseta i stvarne vrednosti klijenata.</p></div><button type="button" className="clients-primary-btn" onClick={() => { setEditingClient(null); setIsModalOpen(true); }}><Plus size={17} />Novi klijent</button></header>
    <section className="client-kpi-grid">
      <KpiCard label="Ukupno klijenata" value={String(kpis.totalClients)} icon={<Users size={18} />} muted="Svi klijenti salona" />
      <KpiCard label="Novi klijenti" value={String(kpis.newClientsThisMonth)} icon={<TrendingUp size={18} />} muted="Kreirani ovog meseca" />
      <KpiCard label="Posete ovog meseca" value={String(kpis.visitsThisMonth)} icon={<CalendarCheck size={18} />} muted="Završeni termini" />
      <KpiCard label="Vraćeni klijenti" value={`${kpis.returningClientsPercent}%`} icon={<Users size={18} />} muted={`${kpis.returningClients}/${kpis.clientsWithVisits} klijenata`} />
      <KpiCard label="Promet od klijenata" value={formatMoney(kpis.revenueThisMonth)} icon={<Euro size={18} />} muted="Završeni termini ovog meseca" />
    </section>
    {clients.error && <div className="clients-error-panel" role="alert"><span>{clients.error}</span><button type="button" onClick={clients.retry}><RefreshCw size={15} /> Pokušaj ponovo</button></div>}
    <div className={`clients-layout ${clients.loading ? "clients-layout--loading" : ""}`}>
      <main className="clients-main"><ClientTable clients={clients.result.items} selectedClient={clients.selectedClient} searchValue={clients.searchValue} status={clients.status} sort={clients.sort} page={clients.result.page} totalPages={clients.result.totalPages} totalCount={clients.result.totalCount} onSearchChange={clients.setSearchValue} onStatusChange={clients.setStatus} onSortChange={clients.setSort} onPageChange={clients.setPage} onSelectClient={clients.selectClient} onDeleteClient={(id) => void clients.handleDeleteClient(id)} onEditClient={(client) => { setEditingClient(editableClient(client)); setIsModalOpen(true); }} /></main>
      <aside className="clients-side"><ClientDetailsPanel client={clients.selectedClient} /></aside>
    </div>
    {isModalOpen && <AddClientModal salonId={clients.salonId} editingClient={editingClient} onClose={() => { setIsModalOpen(false); setEditingClient(null); }} onSaved={async () => { setIsModalOpen(false); setEditingClient(null); clients.reload(); }} />}
  </div>;
}

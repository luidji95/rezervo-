"use client";

import { Eye, Pencil, Search, Trash2 } from "lucide-react";
import type { ClientPageItem, ClientsSort, ClientsStatus } from "@/features/clients/types";
import { formatClientDate, formatMoney } from "./clientUtils";

function pageWindow(current: number, total: number): Array<number | "ellipsis"> {
  const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2].filter((page) => page >= 1 && page <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const output: Array<number | "ellipsis"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) output.push("ellipsis");
    output.push(page);
  });
  return output;
}

export function ClientTable(props: {
  clients: ClientPageItem[]; selectedClient: ClientPageItem | null; searchValue: string;
  status: ClientsStatus; sort: ClientsSort; page: number; totalPages: number; totalCount: number;
  onSearchChange: (value: string) => void; onStatusChange: (value: ClientsStatus) => void;
  onSortChange: (value: ClientsSort) => void; onPageChange: (page: number) => void;
  onSelectClient: (client: ClientPageItem) => void; onEditClient: (client: ClientPageItem) => void; onDeleteClient: (id: string) => void;
}) {
  const pages = pageWindow(props.page, props.totalPages);
  return <section className="clients-card">
    <div className="clients-toolbar">
      <div className="clients-search"><Search size={16} /><input value={props.searchValue} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="Pretraži po imenu, telefonu ili emailu..." /></div>
      <select className="clients-filter" value={props.status} onChange={(event) => props.onStatusChange(event.target.value as ClientsStatus)} aria-label="Status klijenta">
        <option value="all">Svi statusi</option><option value="active">Aktivni</option><option value="blocked">Blokirani</option><option value="archived">Arhivirani</option>
      </select>
      <select className="clients-filter" value={props.sort} onChange={(event) => props.onSortChange(event.target.value as ClientsSort)} aria-label="Sortiranje klijenata">
        <option value="newest">Najnoviji</option><option value="oldest">Najstariji</option><option value="name_asc">Ime A–Ž</option><option value="name_desc">Ime Ž–A</option><option value="most_visits">Najviše poseta</option><option value="highest_spend">Najveći promet</option>
      </select>
    </div>
    <div className="clients-table">
      <div className="clients-table-head"><span>Avatar</span><span>Klijent</span><span>Posete</span><span>Poslednja poseta</span><span>Promet</span><span>Akcije</span></div>
      {props.clients.length === 0 ? <div className="clients-empty"><p>Nema klijenata za izabrane filtere.</p></div> : props.clients.map((client) => <div key={client.id} role="button" tabIndex={0} className={`clients-table-row ${props.selectedClient?.id === client.id ? "active" : ""}`} onClick={() => props.onSelectClient(client)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") props.onSelectClient(client); }}>
        <div className="client-avatar">{client.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "KL"}</div>
        <div className="client-name-cell"><strong>{client.fullName}</strong><span>{client.phone || client.email || "Kontakt nije unet"}</span></div>
        <span>{client.completedVisits}</span><span>{client.lastCompletedVisit ? formatClientDate(client.lastCompletedVisit) : "Nema poseta"}</span><span>{formatMoney(client.completedRevenue)}</span>
        <div className="client-actions-cell"><button type="button" className="client-icon-btn" aria-label="Pregled klijenta" onClick={(event) => { event.stopPropagation(); props.onSelectClient(client); }}><Eye size={15} /></button><button type="button" className="client-icon-btn" aria-label="Izmeni klijenta" onClick={(event) => { event.stopPropagation(); props.onEditClient(client); }}><Pencil size={15} /></button><button type="button" className="client-icon-btn danger" aria-label="Obriši klijenta" onClick={(event) => { event.stopPropagation(); props.onDeleteClient(client.id); }}><Trash2 size={15} /></button></div>
      </div>)}
    </div>
    {props.totalCount > 0 && <div className="clients-pagination"><span>{props.totalCount} klijenata · Strana {props.page} od {props.totalPages}</span><button type="button" disabled={props.page === 1} onClick={() => props.onPageChange(props.page - 1)}>Prethodna</button>{pages.map((page, index) => page === "ellipsis" ? <span key={`ellipsis-${index}`} className="clients-pagination__ellipsis">…</span> : <button key={page} type="button" className={page === props.page ? "active" : ""} onClick={() => props.onPageChange(page)}>{page}</button>)}<button type="button" disabled={props.page === props.totalPages} onClick={() => props.onPageChange(props.page + 1)}>Sledeća</button></div>}
  </section>;
}

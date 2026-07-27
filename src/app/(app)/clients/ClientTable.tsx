"use client";

import { useRef } from "react";
import { Eye, Pencil, Search, Trash2, X } from "lucide-react";
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

type Props = {
  canMutate: boolean;
  clients: ClientPageItem[]; selectedClient: ClientPageItem | null; searchValue: string;
  status: ClientsStatus; sort: ClientsSort; page: number; totalPages: number; totalCount: number;
  onSearchChange: (value: string) => void; onStatusChange: (value: ClientsStatus) => void;
  onSortChange: (value: ClientsSort) => void; onPageChange: (page: number) => void;
  onSelectClient: (client: ClientPageItem) => void; onEditClient: (client: ClientPageItem) => void; onDeleteClient: (id: string) => void;
};

const STATUS_LABELS = { active: "Aktivan", blocked: "Blokiran", archived: "Arhiviran" } as const;

export function ClientTable(props: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const pages = pageWindow(props.page, props.totalPages);
  const emptyMessage = props.searchValue
    ? "Nema klijenata koji odgovaraju pretrazi."
    : props.status !== "all"
      ? "Nema klijenata za izabrani filter."
      : "Još nemate klijente.";
  const changePage = (page: number) => {
    props.onPageChange(page);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <section ref={sectionRef} className="clients-card clients-directory">
    <div className="clients-toolbar">
      <label className="clients-search">
        <span className="clients-control-label">Pretraga</span><Search size={16} />
        <input value={props.searchValue} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="Ime, telefon ili email..." />
        {props.searchValue && <button type="button" aria-label="Očisti pretragu" onClick={() => props.onSearchChange("")}><X size={16} /></button>}
      </label>
      <label className="clients-filter-field"><span>Status</span><select className="clients-filter" value={props.status} onChange={(event) => props.onStatusChange(event.target.value as ClientsStatus)}><option value="all">Svi statusi</option><option value="active">Aktivni</option><option value="blocked">Blokirani</option><option value="archived">Arhivirani</option></select></label>
      <label className="clients-filter-field"><span>Sortiranje</span><select className="clients-filter" value={props.sort} onChange={(event) => props.onSortChange(event.target.value as ClientsSort)}><option value="newest">Najnoviji</option><option value="oldest">Najstariji</option><option value="name_asc">Ime A–Ž</option><option value="name_desc">Ime Ž–A</option><option value="most_visits">Najviše poseta</option><option value="highest_spend">Najveći promet</option></select></label>
    </div>

    <div className="clients-table">
      <div className="clients-table-head"><span>Avatar</span><span>Klijent</span><span>Posete</span><span>Poslednja poseta</span><span>Promet</span><span>Akcije</span></div>
      {props.clients.length === 0 ? <div className="clients-empty"><p>{emptyMessage}</p></div> : props.clients.map((client) => <div key={client.id} role="button" tabIndex={0} className={`clients-table-row ${props.selectedClient?.id === client.id ? "active" : ""}`} onClick={() => props.onSelectClient(client)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") props.onSelectClient(client); }}>
        <div className="client-avatar">{client.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "KL"}</div>
        <div className="client-name-cell"><strong>{client.fullName}</strong><span>{client.phone || client.email || "Kontakt nije unet"}</span></div>
        <span>{client.completedVisits}</span><span>{client.lastCompletedVisit ? formatClientDate(client.lastCompletedVisit) : "Nema poseta"}</span><span>{formatMoney(client.completedRevenue)}</span>
        <div className="client-actions-cell"><button type="button" className="client-icon-btn" aria-label="Pregled klijenta" onClick={(event) => { event.stopPropagation(); props.onSelectClient(client); }}><Eye size={15} /></button><button type="button" disabled={!props.canMutate} className="client-icon-btn" aria-label="Izmeni klijenta" onClick={(event) => { event.stopPropagation(); props.onEditClient(client); }}><Pencil size={15} /></button><button type="button" disabled={!props.canMutate} className="client-icon-btn danger" aria-label="Obriši klijenta" onClick={(event) => { event.stopPropagation(); props.onDeleteClient(client.id); }}><Trash2 size={15} /></button></div>
      </div>)}
    </div>

    <div className="clients-mobile-list">
      {props.clients.length === 0 ? <div className="clients-empty"><p>{emptyMessage}</p></div> : props.clients.map((client) => <article className="clients-mobile-card" key={client.id}>
        <button type="button" className="clients-mobile-card__main" onClick={() => props.onSelectClient(client)}>
          <span className="clients-mobile-card__heading"><strong>{client.fullName}</strong><span className={`client-status-pill ${client.status}`}>{STATUS_LABELS[client.status]}</span></span>
          <span className="clients-mobile-card__contact">{client.phone || "Telefon nije unet"}<small title={client.email ?? undefined}>{client.email || "Email nije unet"}</small></span>
          <span className="clients-mobile-card__metrics"><span><small>Posete</small><strong>{client.completedVisits}</strong></span><span><small>Promet</small><strong>{formatMoney(client.completedRevenue)}</strong></span></span>
          <span className="clients-mobile-card__meta"><span><small>Omiljena usluga</small>{client.favoriteService?.name ?? "Nema podataka"}</span><span><small>Poslednja poseta</small>{client.lastCompletedVisit ? formatClientDate(client.lastCompletedVisit) : "Nema poseta"}</span></span>
        </button>
        <div className="clients-mobile-card__actions"><button type="button" onClick={() => props.onSelectClient(client)}>Detalji</button><button type="button" disabled={!props.canMutate} onClick={() => props.onEditClient(client)}>Izmeni</button><button type="button" disabled={!props.canMutate} className="danger" onClick={() => props.onDeleteClient(client.id)}>Obriši</button></div>
      </article>)}
    </div>

    {props.totalCount > 0 && <div className="clients-pagination"><span className="clients-pagination__summary">{props.totalCount} klijenata · Strana {props.page} od {props.totalPages}</span><button type="button" disabled={props.page === 1} onClick={() => changePage(props.page - 1)}>Prethodna</button><span className="clients-pagination__mobile-label">Strana {props.page} od {props.totalPages}</span><span className="clients-pagination__desktop-pages">{pages.map((page, index) => page === "ellipsis" ? <span key={`ellipsis-${index}`} className="clients-pagination__ellipsis">…</span> : <button key={page} type="button" className={page === props.page ? "active" : ""} onClick={() => changePage(page)}>{page}</button>)}</span><button type="button" disabled={props.page === props.totalPages} onClick={() => changePage(props.page + 1)}>Sledeća</button></div>}
  </section>;
}

import { RotateCcw, UserPlus, UsersRound } from "lucide-react";

import { formatStatisticsCurrency, formatStatisticsNumber } from "../formatters";
import type { StatisticsResponse } from "../types";

export function ClientStatisticsSection({ data }: { data: StatisticsResponse }) {
  const metrics = [
    { label: "Novi klijenti", value: data.overview.newClients, icon: UserPlus },
    { label: "Povratni klijenti", value: data.overview.returningClients, icon: UsersRound },
    { label: "Povratne posete", value: data.overview.returningVisits, icon: RotateCcw },
  ];
  return (
    <section className="statistics-card statistics-clients">
      <div className="statistics-card__header"><div><h2>Klijenti</h2><p>Novi i povratni klijenti izvedeni iz završenih termina.</p></div></div>
      <div className="statistics-clients__metrics">{metrics.map(({ label, value, icon: Icon }) => <div key={label}><Icon size={18} /><span>{label}</span><strong>{formatStatisticsNumber(value)}</strong></div>)}</div>
      <h3>Top klijenti</h3>
      {data.clients.topClients.length === 0 ? <div className="statistics-empty">Nema završenih poseta klijenata u izabranom periodu.</div> : <div className="statistics-table-wrap"><table><thead><tr><th>Klijent</th><th>Završene posete</th><th>Promet</th></tr></thead><tbody>{data.clients.topClients.map((client, index) => <tr key={client.clientId ?? `unknown-${index}`}><td data-label="Klijent"><strong>{client.clientName || "Nepoznat klijent"}</strong></td><td data-label="Završene posete">{formatStatisticsNumber(client.completedVisits)}</td><td data-label="Promet"><strong>{formatStatisticsCurrency(client.revenue, data.overview.currency)}</strong></td></tr>)}</tbody></table></div>}
    </section>
  );
}

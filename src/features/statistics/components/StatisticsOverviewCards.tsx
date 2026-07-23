import { Banknote, CalendarCheck2, RotateCcw, UserPlus, UserRoundCheck, UserX } from "lucide-react";

import { formatStatisticsCurrency, formatStatisticsNumber } from "../formatters";
import type { StatisticsResponse } from "../types";

export function StatisticsOverviewCards({ overview }: { overview: StatisticsResponse["overview"] }) {
  const cards = [
    { label: "Promet iz završenih termina", value: formatStatisticsCurrency(overview.completedRevenue, overview.currency), meta: "Operativna vrednost, ne status naplate", icon: Banknote },
    { label: "Završeni termini", value: formatStatisticsNumber(overview.completedAppointments), meta: "Realizovani termini u periodu", icon: CalendarCheck2 },
    { label: "Novi klijenti", value: formatStatisticsNumber(overview.newClients), meta: "Prva završena poseta u periodu", icon: UserPlus },
    { label: "No-show stopa", value: `${overview.noShowRate.toLocaleString("sr-RS", { maximumFractionDigits: 1 })}%`, meta: "U odnosu na završene i no-show", icon: UserX },
  ];
  return (
    <>
      <section className="statistics-kpis" aria-label="Ključne metrike">
        {cards.map(({ label, value, meta, icon: Icon }) => <article key={label}><Icon /><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></article>)}
      </section>
      <section className="statistics-secondary-kpis" aria-label="Povratni klijenti">
        <div><UserRoundCheck size={18} /><span>Povratni klijenti do kraja perioda</span><strong>{formatStatisticsNumber(overview.returningClients)}</strong></div>
        <div><RotateCcw size={18} /><span>Povratne posete u periodu</span><strong>{formatStatisticsNumber(overview.returningVisits)}</strong></div>
      </section>
    </>
  );
}

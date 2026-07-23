import { formatBookingSource, formatStatisticsNumber } from "../formatters";
import type { StatisticsResponse } from "../types";

export function BookingSourceChart({ appointments }: { appointments: StatisticsResponse["appointments"] }) {
  const maximum = Math.max(...appointments.bySource.map((item) => item.count), 1);
  return (
    <section className="statistics-card statistics-sources">
      <div className="statistics-card__header"><div><h2>Izvor rezervacija</h2><p>Raspodela zakazanih termina, bez conversion interpretacije.</p></div></div>
      {appointments.bySource.length === 0 ? <div className="statistics-empty">Nema izvora rezervacija u izabranom periodu.</div> : <ul>{appointments.bySource.map((item) => {
        const percent = appointments.total > 0 ? item.count / appointments.total * 100 : 0;
        return <li key={item.source}><div><span>{formatBookingSource(item.source)}</span><strong>{formatStatisticsNumber(item.count)} · {percent.toLocaleString("sr-RS", { maximumFractionDigits: 1 })}%</strong></div><div className="statistics-source-bar" aria-label={`${formatBookingSource(item.source)} ${percent.toFixed(1)} procenata`}><i style={{ width: `${item.count / maximum * 100}%` }} /></div></li>;
      })}</ul>}
    </section>
  );
}

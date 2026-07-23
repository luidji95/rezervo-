import { formatStatisticsCurrency, formatStatisticsNumber } from "../formatters";
import type { StatisticsResponse } from "../types";

export function TopServicesTable({ services, currency }: { services: StatisticsResponse["services"]; currency: string }) {
  return (
    <section className="statistics-card statistics-table-card">
      <div className="statistics-card__header"><div><h2>Top usluge</h2><p>Istorijske snapshot vrednosti završenih usluga.</p></div></div>
      {services.length === 0 ? <div className="statistics-empty">Nema realizovanih usluga u izabranom periodu.</div> : <div className="statistics-table-wrap"><table><thead><tr><th>Usluga</th><th>Realizovano</th><th>Promet</th></tr></thead><tbody>{services.map((service) => <tr key={service.serviceKey}><td data-label="Usluga"><strong>{service.serviceName}</strong></td><td data-label="Realizovano">{formatStatisticsNumber(service.completedCount)}</td><td data-label="Promet"><strong>{formatStatisticsCurrency(service.revenue, currency)}</strong></td></tr>)}</tbody></table></div>}
    </section>
  );
}

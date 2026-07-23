import { formatStatisticsCurrency, formatStatisticsNumber } from "../formatters";
import type { StatisticsResponse } from "../types";

export function EmployeePerformanceTable({ employees, currency }: { employees: StatisticsResponse["employees"]; currency: string }) {
  return (
    <section className="statistics-card statistics-table-card statistics-table-card--wide">
      <div className="statistics-card__header"><div><h2>Učinak zaposlenih</h2><p>Operativni ishodi termina, bez rangiranja i occupancy procene.</p></div></div>
      {employees.length === 0 ? <div className="statistics-empty">Nema podataka o zaposlenima u izabranom periodu.</div> : <div className="statistics-table-wrap"><table><thead><tr><th>Zaposleni</th><th>Završeno</th><th>Potvrđeno</th><th>Otkazano</th><th>Nije došao</th><th>Promet</th></tr></thead><tbody>{employees.map((employee, index) => <tr key={employee.employeeId ?? `unknown-${index}`}><td data-label="Zaposleni"><strong>{employee.employeeName || "Nepoznat zaposleni"}</strong></td><td data-label="Završeno">{formatStatisticsNumber(employee.completed)}</td><td data-label="Potvrđeno">{formatStatisticsNumber(employee.confirmed)}</td><td data-label="Otkazano">{formatStatisticsNumber(employee.cancelled)}</td><td data-label="Nije došao">{formatStatisticsNumber(employee.noShow)}</td><td data-label="Promet"><strong>{formatStatisticsCurrency(employee.revenue, currency)}</strong></td></tr>)}</tbody></table></div>}
    </section>
  );
}

"use client";

import { Search } from "lucide-react";

import type { EmployeeStats } from "@/services/employeeAnalyticsService";
import type { Employee } from "@/types/employee";

import {
  formatMoney,
  getInitials,
} from "./employeeUtils";
import type { EmployeeStatusFilter } from "./useEmployeesPageData";

type EmployeeTableProps = {
  employees: Employee[];
  employeeStatsByEmployeeId: Record<string, EmployeeStats>;
  selectedEmployee: Employee | null;
  serviceCountsByEmployeeId: Record<string, number>;
  searchValue: string;
  statusFilter: EmployeeStatusFilter;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: EmployeeStatusFilter) => void;
  onSelectEmployee: (employee: Employee) => void;
};

export function EmployeeTable({
  employees,
  employeeStatsByEmployeeId,
  selectedEmployee,
  serviceCountsByEmployeeId,
  searchValue,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onSelectEmployee,
}: EmployeeTableProps) {
  return (
    <section className="employees-card">
      <div className="employees-toolbar">
        <div className="employees-search">
          <Search size={16} />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Pretraži zaposlene..."
          />
        </div>

        <select
          className="employees-filter"
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(event.target.value as EmployeeStatusFilter)
          }
        >
          <option value="all">Svi statusi</option>
          <option value="active">Aktivni</option>
          <option value="inactive">Neaktivni</option>
        </select>
      </div>

      <div className="employees-table">
        <div className="employees-table-head">
          <span>Zaposleni</span>
          <span>Pozicija</span>
          <span>Usluge</span>
          <span>Termini</span>
          <span>Prihod</span>
          <span>Popunjenost</span>
        </div>

        {employees.length === 0 ? (
          <div className="employees-empty">
            <p>Nema zaposlenih za izabrane filtere.</p>
          </div>
        ) : (
          employees.map((employee) => {
            const isSelected = selectedEmployee?.id === employee.id;
            const stats = employeeStatsByEmployeeId[employee.id];
            const occupancy = stats?.occupancy ?? 0;

            return (
              <button
                key={employee.id}
                type="button"
                className={`employees-table-row ${isSelected ? "active" : ""} ${!employee.is_active ? "inactive" : ""}`}
                onClick={() => onSelectEmployee(employee)}
              >
                <div className="employee-name-cell">
                  <div className="employee-avatar">
                    {getInitials(employee.display_name || employee.full_name)}
                  </div>

                  <div>
                    <strong>
                      {employee.display_name || employee.full_name}
                    </strong>
                    {!employee.is_active && (
                      <span className="employee-status inactive">Neaktivan</span>
                    )}
                    <span>
                      {employee.phone || employee.email || "Nema kontakta"}
                    </span>
                  </div>
                </div>

                <span className="employee-role-pill">
                  {employee.position || "Zaposleni"}
                </span>
                <span>{serviceCountsByEmployeeId[employee.id] ?? 0}</span>
                <span>{stats?.totalAppointments ?? 0}</span>
                <span>{formatMoney(stats?.revenue ?? 0)}</span>

                <div className="employee-occupancy-cell">
                  <span>{occupancy}%</span>
                  <div className="employee-progress-track">
                    <div
                      className="employee-progress-fill"
                      style={{ width: `${occupancy}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {employees.length > 0 && (
        <div className="employees-mobile-list" aria-label="Lista zaposlenih">
          {employees.map((employee) => {
            const stats = employeeStatsByEmployeeId[employee.id];
            const name = employee.display_name || employee.full_name;

            return (
              <article key={employee.id} className={`employee-mobile-card ${employee.is_active ? "" : "inactive"}`}>
                <button
                  type="button"
                  className="employee-mobile-card-main"
                  onClick={() => onSelectEmployee(employee)}
                  aria-label={`Otvori detalje zaposlenog ${name}`}
                >
                  <span className="employee-mobile-heading">
                    <span className="employee-avatar" aria-hidden="true">{getInitials(name)}</span>
                    <span className="employee-mobile-identity">
                      <strong>{name}</strong>
                      <span>{employee.position || "Zaposleni"}</span>
                      <small>{employee.phone || employee.email || "Nema kontakta"}</small>
                    </span>
                  </span>

                  <span className="employee-mobile-statuses">
                    <span className={`employee-status ${employee.is_active ? "active" : "inactive"}`}>
                      {employee.is_active ? "Aktivan" : "Neaktivan"}
                    </span>
                    <span className={`employee-status ${employee.is_bookable ? "active" : "inactive"}`}>
                      {employee.is_bookable ? "Prima rezervacije" : "Nije dostupan za rezervacije"}
                    </span>
                    <span className={`employee-status ${employee.is_public ? "active" : "inactive"}`}>
                      {employee.is_public ? "Javno vidljiv" : "Nije javno vidljiv"}
                    </span>
                  </span>

                  <span className="employee-mobile-metrics">
                    <span><small>Usluge</small><strong>{serviceCountsByEmployeeId[employee.id] ?? 0}</strong></span>
                    <span><small>Termini</small><strong>{stats?.totalAppointments ?? 0}</strong></span>
                    <span><small>Profil</small><strong>{employee.profile_id ? "Povezan" : "Nije povezan"}</strong></span>
                  </span>
                </button>
                <button type="button" className="employees-secondary-btn employee-mobile-edit" onClick={() => onSelectEmployee(employee)}>
                  Detalji i izmena
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

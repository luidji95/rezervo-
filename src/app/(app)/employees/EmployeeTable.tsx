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
                className={`employees-table-row ${isSelected ? "active" : ""}`}
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
    </section>
  );
}

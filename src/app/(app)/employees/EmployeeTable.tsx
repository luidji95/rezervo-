"use client";

import {
  Eye,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";

import type { Employee } from "@/types/employee";
import type { WorkingHour } from "@/types/workingHour";

import {
  getDummyOccupancy,
  getEmployeeMainWorkingTime,
  getInitials,
} from "./employeeUtils";
import type { EmployeeStatusFilter } from "./useEmployeesPageData";

type EmployeeTableProps = {
  employees: Employee[];
  selectedEmployee: Employee | null;
  salonWorkingHours: WorkingHour[];
  searchValue: string;
  statusFilter: EmployeeStatusFilter;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: EmployeeStatusFilter) => void;
  onSelectEmployee: (employee: Employee) => void;
  onDeleteEmployee: (employeeId: string) => void;
};

export function EmployeeTable({
  employees,
  selectedEmployee,
  salonWorkingHours,
  searchValue,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onSelectEmployee,
  onDeleteEmployee,
}: EmployeeTableProps) {
  return (
    <section className="employees-card">
      <div className="employees-toolbar">
        <div className="employees-search">
          <Search size={16} />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="PretraÅ¾i zaposlene..."
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
          <span>Uloga</span>
          <span>Tim</span>
          <span>Radno vreme</span>
          <span>Popunjenost</span>
          <span>Akcije</span>
        </div>

        {employees.length === 0 ? (
          <div className="employees-empty">
            <p>Nema zaposlenih za izabrane filtere.</p>
          </div>
        ) : (
          employees.map((employee) => {
            const isSelected = selectedEmployee?.id === employee.id;
            const occupancy = getDummyOccupancy(employee.id);

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

                <span>Frizerski tim</span>

                <span>{getEmployeeMainWorkingTime(salonWorkingHours)}</span>

                <div className="employee-occupancy-cell">
                  <span>{occupancy}%</span>
                  <div className="employee-progress-track">
                    <div
                      className="employee-progress-fill"
                      style={{ width: `${occupancy}%` }}
                    />
                  </div>
                </div>

                <div className="employee-actions-cell">
                  <span className="employee-icon-btn">
                    <Eye size={15} />
                  </span>

                  <span className="employee-icon-btn">
                    <Pencil size={15} />
                  </span>

                  <span
                    className="employee-icon-btn danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteEmployee(employee.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </span>

                  <span className="employee-icon-btn">
                    <MoreVertical size={15} />
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

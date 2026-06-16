"use client";

import { useState } from "react";
import { Briefcase, CalendarDays, Plus, UserRound } from "lucide-react";

import { AddEmployeeModal } from "./AddEmployeeModal";
import { EmployeeDetailsPanel } from "./EmployeeDetailsPanel";
import { EmployeeTable } from "./EmployeeTable";
import { KpiCard } from "./KpiCard";
import { useEmployeesPageData } from "./useEmployeesPageData";

import "./employees.css";

export default function EmployeesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);

  const {
    activeEmployees,
    currentSalon,
    filteredEmployees,
    getServicesForEmployee,
    handleDeleteEmployee,
    loadData,
    loading,
    salonId,
    salonLoading,
    salonWorkingHours,
    searchValue,
    selectedEmployee,
    selectedEmployeeHours,
    services,
    setSearchValue,
    setSelectedEmployee,
    setStatusFilter,
    statusFilter,
    totalEmployees,
  } = useEmployeesPageData();

  if (salonLoading || loading) {
    return (
      <div className="employees-page">
        <div className="employees-card">
          <p>Učitavanje zaposlenih...</p>
        </div>
      </div>
    );
  }

  if (!currentSalon || !salonId) {
    return (
      <div className="employees-page">
        <div className="employees-card">
          <p className="employees-error">Salon nije pronađen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="employees-page">
      <header className="employees-header">
        <div>
          <h1>Zaposleni</h1>
          <p>Pregled tima, usluga, radnog vremena i osnovnih performansi.</p>
        </div>

        <button
          type="button"
          className="employees-primary-btn"
          onClick={() => setIsModalOpen(true)}
        >
          <Plus size={17} />
          Novi zaposleni
        </button>
      </header>

      <section className="employee-kpi-grid">
        <KpiCard
          label="Ukupno zaposlenih"
          value={String(totalEmployees)}
          icon={<UserRound size={18} />}
        />
        <KpiCard
          label="Aktivni zaposleni"
          value={String(activeEmployees)}
          icon={<Briefcase size={18} />}
        />
        <KpiCard
          label="Ukupan prihod"
          value="€12.450"
          icon={<CalendarDays size={18} />}
          muted="dummy"
        />
        <KpiCard
          label="Popunjenost"
          value="84%"
          icon={<CalendarDays size={18} />}
          muted="dummy"
        />
      </section>

      <div className="employees-layout">
        <main className="employees-main">
          <EmployeeTable
            employees={filteredEmployees}
            selectedEmployee={selectedEmployee}
            salonWorkingHours={salonWorkingHours}
            searchValue={searchValue}
            statusFilter={statusFilter}
            onSearchChange={setSearchValue}
            onStatusFilterChange={setStatusFilter}
            onSelectEmployee={setSelectedEmployee}
            onDeleteEmployee={(employeeId) => {
              void handleDeleteEmployee(employeeId);
            }}
          />
        </main>

        <aside className="employees-side">
          <EmployeeDetailsPanel
            employee={selectedEmployee}
            services={
              selectedEmployee ? getServicesForEmployee(selectedEmployee.id) : []
            }
            salonWorkingHours={salonWorkingHours}
            employeeWorkingHours={selectedEmployeeHours}
          />
        </aside>
      </div>

      {isModalOpen && (
        <AddEmployeeModal
          salonId={salonId}
          services={services}
          selectedServiceIds={selectedServiceIds}
          setSelectedServiceIds={setSelectedServiceIds}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedServiceIds([]);
          }}
          onCreated={async () => {
            setIsModalOpen(false);
            setSelectedServiceIds([]);
            await loadData();
          }}
        />
      )}
    </div>
  );
}

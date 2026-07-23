"use client";

import { useCallback, useState } from "react";
import { Briefcase, CalendarDays, Plus, UserRound } from "lucide-react";

import { AddEmployeeModal } from "./AddEmployeeModal";
import { EmployeeDeleteModal } from "./EmployeeDeleteModal";
import { EmployeeDetailsPanel } from "./EmployeeDetailsPanel";
import { EmployeeEditModal } from "./EmployeeEditModal";
import { EmployeeTable } from "./EmployeeTable";
import { KpiCard } from "./KpiCard";
import { formatMoney } from "./employeeUtils";
import { useEmployeesPageData } from "./useEmployeesPageData";
import {
  deleteEmployeeSafely,
  EmployeeHasFutureAppointmentsError,
  restoreEmployee,
} from "@/services/employeeService";
import type { Employee } from "@/types/employee";

import "./employees.css";

export default function EmployeesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [restoringEmployeeId, setRestoringEmployeeId] = useState<string | null>(
    null
  );
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  const {
    currentSalon,
    employeeKPIs,
    employeeStatsByEmployeeId,
    filteredEmployees,
    getServicesForEmployee,
    loadData,
    loadError,
    loading,
    salonId,
    salonLoading,
    salonWorkingHours,
    searchValue,
    selectedEmployee,
    selectedEmployeeHours,
    selectedEmployeeStats,
    serviceCountsByEmployeeId,
    services,
    setSearchValue,
    setSelectedEmployee,
    setStatusFilter,
    statusFilter,
  } = useEmployeesPageData();

  function handleSelectEmployee(employee: Employee) {
    setSelectedEmployee(employee);
    if (window.matchMedia("(max-width: 767px)").matches) setMobileDetailsOpen(true);
  }

  const closeMobileDetails = useCallback(() => setMobileDetailsOpen(false), []);

  async function handleDeleteEmployee() {
    if (!deletingEmployee || !salonId || isDeleting) return;

    try {
      setIsDeleting(true);
      setDeleteError("");
      const result = await deleteEmployeeSafely({
        employeeId: deletingEmployee.id,
        salonId,
      });
      setDeletingEmployee(null);
      await loadData();

      if (result.mode === "hard") {
        setSelectedEmployee(null);
      }
    } catch (error) {
      console.error("Failed to remove employee:", error);
      setDeleteError(
        error instanceof EmployeeHasFutureAppointmentsError
          ? "Zaposleni ima buduće pending ili confirmed termine. Prvo ih premestite ili otkažite."
          : "Zaposlenog trenutno nije moguće ukloniti. Pokušajte ponovo."
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleRestoreEmployee(employee: Employee) {
    if (!salonId || restoringEmployeeId) return;

    try {
      setRestoringEmployeeId(employee.id);
      await restoreEmployee({ employeeId: employee.id, salonId });
      await loadData();
    } catch (error) {
      console.error("Failed to restore employee:", error);
    } finally {
      setRestoringEmployeeId(null);
    }
  }

  if (salonLoading || loading) {
    return (
      <div className="employees-page" aria-busy="true" aria-label="Učitavanje zaposlenih">
        <div className="employees-loading-header"><span /><span /></div>
        <div className="employee-kpi-grid employees-loading-kpis">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
        <div className="employees-card employees-loading-list">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
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

  if (loadError) {
    return (
      <div className="employees-page">
        <section className="employees-card employees-load-error" role="alert">
          <h1>Zaposleni trenutno nisu dostupni</h1>
          <p>Pokušajte ponovo. Ostali delovi aplikacije ostaju dostupni.</p>
          <button type="button" className="employees-primary-btn" onClick={() => void loadData()}>
            Pokušaj ponovo
          </button>
        </section>
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
          value={String(employeeKPIs.totalEmployees)}
          icon={<UserRound size={18} />}
        />
        <KpiCard
          label="Aktivni danas"
          value={String(employeeKPIs.activeToday)}
          icon={<Briefcase size={18} />}
        />
        <KpiCard
          label="Ukupan prihod"
          value={formatMoney(employeeKPIs.totalRevenue)}
          icon={<CalendarDays size={18} />}
          muted="Completed termini"
        />
        <KpiCard
          label="Prosečna popunjenost"
          value={`${employeeKPIs.averageOccupancy}%`}
          icon={<CalendarDays size={18} />}
          muted="Prema radnom vremenu"
        />
      </section>

      <div className="employees-layout">
        <main className="employees-main">
          <EmployeeTable
            employees={filteredEmployees}
            employeeStatsByEmployeeId={employeeStatsByEmployeeId}
            selectedEmployee={selectedEmployee}
            serviceCountsByEmployeeId={serviceCountsByEmployeeId}
            searchValue={searchValue}
            statusFilter={statusFilter}
            onSearchChange={setSearchValue}
            onStatusFilterChange={setStatusFilter}
            onSelectEmployee={handleSelectEmployee}
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
            stats={selectedEmployeeStats}
            isRestoring={restoringEmployeeId === selectedEmployee?.id}
            mobileOpen={mobileDetailsOpen}
            onClose={closeMobileDetails}
            onEdit={(employee) => { setMobileDetailsOpen(false); setEditingEmployee(employee); }}
            onDelete={(employee) => {
              setDeleteError("");
              setDeletingEmployee(employee);
            }}
            onRestore={handleRestoreEmployee}
          />
        </aside>
      </div>

      {isModalOpen && (
        <AddEmployeeModal
          salonId={salonId}
          services={services.filter((service) => service.is_active)}
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

      {editingEmployee && (
        <EmployeeEditModal
          employee={editingEmployee}
          salonId={salonId}
          services={services.filter((service) => service.is_active)}
          initialServiceIds={getServicesForEmployee(editingEmployee.id)
            .filter((service) => service.is_active)
            .map((service) => service.id)}
          onClose={() => setEditingEmployee(null)}
          onSaved={async () => {
            setEditingEmployee(null);
            await loadData();
          }}
        />
      )}

      {deletingEmployee && (
        <EmployeeDeleteModal
          employee={deletingEmployee}
          error={deleteError}
          isDeleting={isDeleting}
          onCancel={() => {
            if (!isDeleting) {
              setDeletingEmployee(null);
              setDeleteError("");
            }
          }}
          onConfirm={handleDeleteEmployee}
        />
      )}
    </div>
  );
}

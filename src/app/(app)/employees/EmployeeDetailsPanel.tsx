"use client";

import { useEffect, useRef } from "react";
import {
  CalendarDays,
  Mail,
  Pencil,
  Phone,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import type { EmployeeStats } from "@/services/employeeAnalyticsService";
import type { Employee } from "@/types/employee";
import type { Service } from "@/types/service";
import type { WorkingHour } from "@/types/workingHour";

import {
  DAYS,
  formatDate,
  formatEmployeeDate,
  formatMoney,
  formatWorkingHour,
  getInitials,
} from "./employeeUtils";

type EmployeeDetailsPanelProps = {
  employee: Employee | null;
  services: Service[];
  salonWorkingHours: WorkingHour[];
  employeeWorkingHours: WorkingHour[];
  stats: EmployeeStats;
  isRestoring: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onDelete: (employee: Employee) => void;
  onEdit: (employee: Employee) => void;
  onRestore: (employee: Employee) => Promise<void>;
};

export function EmployeeDetailsPanel({
  employee,
  services,
  salonWorkingHours,
  employeeWorkingHours,
  stats,
  isRestoring,
  mobileOpen,
  onClose,
  onDelete,
  onEdit,
  onRestore,
}: EmployeeDetailsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileOpen || !employee) return;
    const panel = panelRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = panel?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [employee, mobileOpen, onClose]);

  if (!employee) {
    return (
      <section className="employees-card employee-details-empty">
        <p>Izaberi zaposlenog iz liste za pregled detalja.</p>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className={`employees-card employee-details-card ${mobileOpen ? "mobile-open" : ""}`}
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen ? true : undefined}
      aria-labelledby="employee-details-title"
    >
      <button type="button" className="employee-details-close" onClick={onClose} aria-label="Zatvori detalje zaposlenog"><X size={20} /></button>
      <div className="employee-details-header">
        <div className="employee-details-avatar">
          {getInitials(employee.display_name || employee.full_name)}
        </div>

        <div>
          <h3 id="employee-details-title">{employee.display_name || employee.full_name}</h3>
          <p>{employee.position || "Zaposleni"}</p>
          {!employee.is_active && (
            <span className="employee-status inactive">Neaktivan</span>
          )}
        </div>
      </div>

      <div className="employee-section employee-profile-status">
        <h4>Pristup aplikaciji</h4>
        <span className={`employee-status ${employee.profile_id ? "active" : "inactive"}`}>
          {employee.profile_id ? "Profil je povezan" : "Profil nije povezan"}
        </span>
      </div>

      <div className="employee-details-actions">
        <button
          type="button"
          className="employees-secondary-btn"
          onClick={() => onEdit(employee)}
        >
          <Pencil size={15} /> Izmeni
        </button>

        {employee.is_active ? (
          <button
            type="button"
            className="employees-danger-btn"
            onClick={() => onDelete(employee)}
          >
            <Trash2 size={15} /> Obriši zaposlenog
          </button>
        ) : (
          <button
            type="button"
            className="employees-primary-btn"
            onClick={() => void onRestore(employee)}
            disabled={isRestoring}
          >
            <RotateCcw size={15} />
            {isRestoring ? "Aktiviram..." : "Aktiviraj"}
          </button>
        )}
      </div>

      <div className="employee-section">
        <h4>Kontakt</h4>
        <div className="employee-info-list">
          <InfoRow
            icon={<Phone size={15} />}
            label="Telefon"
            value={employee.phone || "Nije uneto"}
          />
          <InfoRow
            icon={<Mail size={15} />}
            label="Email"
            value={employee.email || "Nije uneto"}
          />
          <InfoRow
            icon={<CalendarDays size={15} />}
            label="Dodat"
            value={formatDate(employee.created_at)}
          />
        </div>
      </div>

      <div className="employee-section">
        <h4>Usluge koje radi</h4>

        {services.length === 0 ? (
          <p className="employee-muted-text">Nema dodeljenih usluga.</p>
        ) : (
          <div className="employee-service-tags">
            {services.map((service) => (
              <span key={service.id}>{service.name}</span>
            ))}
          </div>
        )}
      </div>

      <div className="employee-section">
        <h4>Radno vreme</h4>

        <div className="employee-working-list">
          {DAYS.map((day) => {
            const override = employeeWorkingHours.find(
              (hour) => hour.day_of_week === day.value
            );

            const salonDefault = salonWorkingHours.find(
              (hour) => hour.day_of_week === day.value
            );

            return (
              <div key={day.value}>
                <span>{day.label}</span>
                <strong>{formatWorkingHour(override ?? salonDefault)}</strong>
              </div>
            );
          })}
        </div>
      </div>

      <div className="employee-section">
        <h4>Učinak</h4>

        <div className="employee-stats-grid">
          <MiniStat label="Termini" value={String(stats.totalAppointments)} />
          <MiniStat
            label="Završeni"
            value={String(stats.completedAppointments)}
          />
          <MiniStat label="Prihod" value={formatMoney(stats.revenue)} />
          <MiniStat label="Popunjenost" value={`${stats.occupancy}%`} />
        </div>
      </div>

      <div className="employee-section">
        <h4>Klijenti</h4>

        <div className="employee-stats-grid">
          <MiniStat label="Novi klijenti" value={String(stats.newClients)} />
          <MiniStat label="Povratni" value={String(stats.returningClients)} />
        </div>
      </div>

      <div className="employee-section">
        <h4>Statistika</h4>

        <div className="employee-stats-grid">
          <MiniStat
            label="Poslednji termin"
            value={formatEmployeeDate(stats.lastAppointmentAt)}
          />
          <MiniStat
            label="Prosečna vrednost"
            value={formatMoney(stats.averageAppointmentValue)}
          />
        </div>
      </div>
    </section>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="employee-info-row">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="employee-mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

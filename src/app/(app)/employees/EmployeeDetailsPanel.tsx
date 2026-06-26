import { CalendarDays, Mail, Phone } from "lucide-react";

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
};

export function EmployeeDetailsPanel({
  employee,
  services,
  salonWorkingHours,
  employeeWorkingHours,
  stats,
}: EmployeeDetailsPanelProps) {
  if (!employee) {
    return (
      <section className="employees-card employee-details-empty">
        <p>Izaberi zaposlenog iz liste za pregled detalja.</p>
      </section>
    );
  }

  return (
    <section className="employees-card employee-details-card">
      <div className="employee-details-header">
        <div className="employee-details-avatar">
          {getInitials(employee.display_name || employee.full_name)}
        </div>

        <div>
          <h3>{employee.display_name || employee.full_name}</h3>
          <p>{employee.position || "Zaposleni"}</p>
        </div>
      </div>

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
        <h4>Statistika</h4>

        <div className="employee-stats-grid">
          <MiniStat label="Termini" value={String(stats.totalAppointments)} />
          <MiniStat
            label="Završeni"
            value={String(stats.completedAppointments)}
          />
          <MiniStat label="Prihod" value={formatMoney(stats.revenue)} />
          <MiniStat label="Novi klijenti" value={String(stats.newClients)} />
          <MiniStat label="Povratni" value={String(stats.returningClients)} />
          <MiniStat label="Popunjenost" value={`${stats.occupancy}%`} />
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

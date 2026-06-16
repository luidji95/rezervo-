import { CalendarDays, Mail, Phone } from "lucide-react";

import type { Employee } from "@/types/employee";
import type { Service } from "@/types/service";
import type { WorkingHour } from "@/types/workingHour";

import {
  DAYS,
  formatDate,
  formatWorkingHour,
  getInitials,
} from "./employeeUtils";

type EmployeeDetailsPanelProps = {
  employee: Employee | null;
  services: Service[];
  salonWorkingHours: WorkingHour[];
  employeeWorkingHours: WorkingHour[];
};

export function EmployeeDetailsPanel({
  employee,
  services,
  salonWorkingHours,
  employeeWorkingHours,
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
        <h4>Statistika meseca</h4>

        <div className="employee-stats-grid">
          <MiniStat label="Termini" value="42" />
          <MiniStat label="Prihod" value="â‚¬1.240" />
          <MiniStat label="Popunjenost" value="78%" />
          <MiniStat label="Novi klijenti" value="12" />
          <MiniStat label="Povratni" value="30" />
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

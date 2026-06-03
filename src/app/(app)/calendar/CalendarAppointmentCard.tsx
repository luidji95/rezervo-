"use client";

import type { CalendarAppointment } from "@/services/calendarQueryService";

type CalendarAppointmentCardProps = {
  appointment: CalendarAppointment;
  top: number;
  height: number;
  isSelected: boolean;
  onSelect: (appointment: CalendarAppointment) => void;
};

// 1. ČISTI HELPER ZA CSS KLASE (Samo stabilne engleske vrednosti iz baze)
function getAppointmentStatusClass(status: string) {
  const normalizedStatus = status?.toLowerCase().trim();

  switch (normalizedStatus) {
    case "confirmed":
      return "calendar-appointment-card--confirmed";
    case "completed":
      return "calendar-appointment-card--completed";
    case "cancelled":
      return "calendar-appointment-card--cancelled";
    case "pending":
      return "calendar-appointment-card--pending";
    case "no_show":
      return "calendar-appointment-card--no-show";
    default:
      return "calendar-appointment-card--default";
  }
}

// 2. HELPER ZA UI PRIKAZ (Prevod na srpski jezik u lejeru prezentacije)
function getAppointmentStatusLabel(status: string) {
  const normalizedStatus = status?.toLowerCase().trim();

  switch (normalizedStatus) {
    case "confirmed":
      return "Potvrđeno";
    case "completed":
      return "Završeno";
    case "cancelled":
      return "Otkazano";
    case "pending":
      return "Na čekanju";
    case "no_show":
      return "Nije došao";
    default:
      return status; // Ako se pojavi nešto nepoznato, ispiši sirovu vrednost
  }
}

export default function CalendarAppointmentCard({
  appointment,
  top,
  height,
  isSelected,
  onSelect,
}: CalendarAppointmentCardProps) {
  
  const statusClass = getAppointmentStatusClass(appointment.status);
  const isSelectedClass = isSelected ? "calendar-appointment-card--selected" : "";
  
  return (
    <div
      className={`calendar-appointment-card ${statusClass} ${isSelectedClass}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      onClick={() => onSelect(appointment)}
    >
      {/* Vreme trajanja termina */}
      <div className="calendar-appointment-time">
        {new Date(appointment.start_time).toLocaleTimeString("sr-RS", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {" - "}
        {new Date(appointment.end_time).toLocaleTimeString("sr-RS", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>

      {/* Detalji o klijentu i usluzi */}
      <div className="calendar-appointment-details">
        <span className="calendar-appointment-client">
          {appointment.clients?.full_name ?? "Klijent"}
        </span>
        <span className="calendar-appointment-service">
          • {appointment.services?.name ?? "Usluga"}
        </span>
      </div>

      {/* Status termina - UI label na srpskom */}
        
    </div>
  );
}